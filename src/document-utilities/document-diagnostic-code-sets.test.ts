import { describe, expect, it } from 'vitest'
import {
  LATENT_ATX_LEVEL_CODES,
  computeDocumentDiagnosticCodeSetAudit,
  expandedRuntimeCodesOf,
} from './document-diagnostic-code-sets'
import { DOCUMENT_DIAGNOSTIC_RULE_REGISTRY, getRuleMeta } from './document-diagnostic-location'

const audit = computeDocumentDiagnosticCodeSetAudit()

describe('B1 §B1-01 — diagnostic code-set authority', () => {
  it('keeps families, resolved keys, expanded codes and producer codes separate', () => {
    expect(audit.counts.registeredFamilyCount).toBe(109)
    expect(audit.counts.registryResolvedKeyCount).toBe(115)
    expect(audit.counts.expandedRuntimeCodeCount).toBe(120)
    expect(audit.counts.producerSupportedCodeCount).toBe(116)
    expect(audit.counts.runtimeReachableCodeCount).toBe(111)
  })

  it('expands LATENT to six concrete codes but keeps one registry sentinel', () => {
    expect(LATENT_ATX_LEVEL_CODES).toHaveLength(6)
    const meta = DOCUMENT_DIAGNOSTIC_RULE_REGISTRY.LATENT_ATX_HEADING_MARKER
    expect(expandedRuntimeCodesOf(meta)).toEqual([...LATENT_ATX_LEVEL_CODES])
    // The family-level resolver still yields the ONE sentinel.
    expect(meta.runtimeCodePolicy).toEqual({ kind: 'PREFIX', prefix: 'LATENT_ATX_HEADING_MARKER' })
    expect(audit.differences.expandedNotRegistryResolved).toEqual([...LATENT_ATX_LEVEL_CODES].sort())
    expect(audit.differences.registryResolvedNotExpanded).toEqual(['LATENT_ATX_HEADING_MARKER_*'])
  })

  it('producer 116 and registry 115 differ in BOTH size and set', () => {
    expect(audit.counts.producerSupportedCodeCount).toBe(116)
    expect(audit.counts.registryResolvedKeyCount).toBe(115)
    expect(audit.differences.producerNotRegistryResolved).toEqual([...LATENT_ATX_LEVEL_CODES].sort())
    expect(audit.differences.registryResolvedNotProducer).toEqual(
      [
        'FIGURE_REFERENCE_TARGET_MISSING',
        'FORMULA_REFERENCE_TARGET_MISSING',
        'LATENT_ATX_HEADING_MARKER_*',
        'LINK_LOCAL_FILE_ANCHOR_MISSING',
        'TABLE_REFERENCE_TARGET_MISSING',
      ].sort(),
    )
  })

  it('producer-supported is a strict subset of expanded; the five missing codes are exactly DEFERRED', () => {
    expect(audit.invariants.producerSubsetOfExpanded).toBe(true)
    expect(audit.invariants.expandedMinusProducerEqualsDeferred).toBe(true)
    expect(audit.differences.expandedNotProducer).toEqual(audit.deferredCodes)
    expect(audit.deferredFamilies).toEqual([
      'FIGURE_REFERENCE_TARGET_MISSING',
      'FORMULA_REFERENCE_TARGET_MISSING',
      'LINK_LOCAL_FILE_ANCHOR_MISSING',
      'TABLE_REFERENCE_TARGET_MISSING',
    ])
    expect(audit.deferredCodes).toEqual([
      'FIGURE_REFERENCE_TARGET_MISSING',
      'FORMULA_REFERENCE_TARGET_MISSING',
      'LINK_LOCAL_FILE_ANCHOR_MISSING',
      'TABLE_REFERENCE_TARGET_MISSING',
    ])
  })

  it('reachability is derived from defaultEnabled + knownUnreachable, not from a hand-written number', () => {
    expect(audit.defaultDisabledCodes).toEqual([
      'CB008',
      'CB010',
      'FORMULA_SOURCE_LENGTH_EXCEEDING',
      'FORMULA_SOURCE_LINE_TOO_LONG',
    ])
    expect(audit.knownUnreachableCodes).toEqual(['STRICT_FIRST_H1_DOCUMENT_EMPTY'])
    expect(audit.producerUnreachableCodes).toEqual([
      'CB008',
      'CB010',
      'FORMULA_SOURCE_LENGTH_EXCEEDING',
      'FORMULA_SOURCE_LINE_TOO_LONG',
      'STRICT_FIRST_H1_DOCUMENT_EMPTY',
    ])
    expect(audit.runtimeReachableCodes).toContain('CB007')
    expect(audit.runtimeReachableCodes).not.toContain('STRICT_FIRST_H1_DOCUMENT_EMPTY')
    expect(audit.runtimeReachableCodes).not.toContain('CB008')
    expect(audit.runtimeReachableCodes).not.toContain('CB010')
    expect(audit.runtimeReachableCodes).not.toContain('FORMULA_SOURCE_LENGTH_EXCEEDING')
    expect(audit.runtimeReachableCodes).not.toContain('FORMULA_SOURCE_LINE_TOO_LONG')
    expect(audit.invariants.reachablePlusUnreachableEqualsProducer).toBe(true)
    expect(audit.counts.runtimeReachableCodeCount).toBe(111)
  })

  it('severity counts are conserved in baseline and strict modes', () => {
    expect(audit.counts.expandedBySeverity).toEqual({ error: 17, warning: 74, hint: 29 })
    expect(audit.counts.expandedBySeverityStrict).toEqual({ error: 19, warning: 78, hint: 23 })
    expect(audit.counts.producerBySeverity).toEqual({ error: 17, warning: 70, hint: 29 })
    expect(audit.counts.producerBySeverityStrict).toEqual({ error: 19, warning: 74, hint: 23 })
    expect(audit.counts.reachableBySeverity).toEqual({ error: 17, warning: 67, hint: 27 })
    expect(audit.counts.reachableBySeverityStrict).toEqual({ error: 19, warning: 71, hint: 21 })
    for (const [counts, total] of [
      [audit.counts.expandedBySeverity, 120],
      [audit.counts.expandedBySeverityStrict, 120],
      [audit.counts.producerBySeverity, 116],
      [audit.counts.producerBySeverityStrict, 116],
      [audit.counts.reachableBySeverity, 111],
      [audit.counts.reachableBySeverityStrict, 111],
    ] as const) {
      expect(counts.error + counts.warning + counts.hint).toBe(total)
    }
  })

  it('no duplicate expanded codes and every code resolves to a family', () => {
    expect(audit.invariants.noDuplicateExpandedCodes).toBe(true)
    expect(audit.invariants.everyExpandedCodeResolves).toBe(true)
    expect(audit.invariants.everyProducerCodeResolves).toBe(true)
    for (const code of audit.expandedRuntimeCodes) {
      expect(getRuleMeta(code), code).not.toBeNull()
    }
    expect(audit.verifiedRuntimeFamilies).toEqual([])
  })
})
