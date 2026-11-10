/**
 * B1 §B1-01 — the ONE read-only diagnostic CODE-SET authority.
 *
 * The project has four different legitimate counting spaces and they MUST NOT be
 * conflated:
 *
 *   1. rule FAMILIES                  — `DOCUMENT_DIAGNOSTIC_RULE_REGISTRY` keys;
 *   2. registry-RESOLVED keys         — `resolvedRuntimeCodesOf()` (LATENT keeps
 *                                       ONE `*` sentinel);
 *   3. EXPANDED runtime codes         — every concrete code the producer can
 *                                       emit (LATENT expands to LEVEL_1..6);
 *   4. PRODUCER-supported codes       — the producer allow-list;
 *   5. RUNTIME-REACHABLE codes        — producer-supported minus default-disabled
 *                                       and provably-unreachable codes.
 *
 * This module makes the differences explicit and programmatically checkable. It
 * never mutates the registry, the producer or a diagnostic.
 */
import {
  DOCUMENT_DIAGNOSTIC_RULE_REGISTRY,
  getRuleMeta,
  resolvedRuntimeCodesOf,
  type DocumentDiagnosticRuleMeta,
} from './document-diagnostic-location'
import { PRODUCED_DIAGNOSTIC_CODES } from './document-diagnostics'

/** LATENT expands to exactly these six concrete codes at runtime. */
export const LATENT_ATX_LEVEL_CODES: readonly string[] = Object.freeze([
  'LATENT_ATX_HEADING_MARKER_LEVEL_1',
  'LATENT_ATX_HEADING_MARKER_LEVEL_2',
  'LATENT_ATX_HEADING_MARKER_LEVEL_3',
  'LATENT_ATX_HEADING_MARKER_LEVEL_4',
  'LATENT_ATX_HEADING_MARKER_LEVEL_5',
  'LATENT_ATX_HEADING_MARKER_LEVEL_6',
])

/**
 * Expand a family's runtime codes into CONCRETE codes. This is deliberately
 * different from `resolvedRuntimeCodesOf()`: a PREFIX family is one sentinel in
 * the registry count but six real codes in the producer/runtime count.
 */
export function expandedRuntimeCodesOf(meta: DocumentDiagnosticRuleMeta): string[] {
  const policy = meta.runtimeCodePolicy
  if (policy.kind === 'EXACT') return [policy.code]
  if (policy.kind === 'PATTERN') return [...policy.codes]
  if (policy.prefix === 'LATENT_ATX_HEADING_MARKER') return [...LATENT_ATX_LEVEL_CODES]
  return [`${policy.prefix}_*`]
}

export interface DiagnosticSeverityCounts {
  error: number
  warning: number
  hint: number
}

export interface DiagnosticCodeSetAudit {
  /** Sorted family ids (one per registered family). */
  registeredFamilyIds: readonly string[]
  /** Sorted registry-resolved keys (LATENT = one `*` sentinel). */
  registryResolvedKeys: readonly string[]
  /** Sorted concrete codes (LATENT = six LEVEL codes). */
  expandedRuntimeCodes: readonly string[]
  /** Sorted producer allow-list. */
  producerSupportedCodes: readonly string[]
  /** Sorted producer-supported codes that are enabled by default and reachable. */
  runtimeReachableCodes: readonly string[]
  /** Registered families with implementationStatus = DEFERRED_BY_SPEC. */
  deferredFamilies: readonly string[]
  /** Concrete codes of deferred families (no producer). */
  deferredCodes: readonly string[]
  /** Producer-supported codes disabled by default (defaultEnabled=false). */
  defaultDisabledCodes: readonly string[]
  /** Producer-supported codes provably unreachable even when wired. */
  knownUnreachableCodes: readonly string[]
  /** Union of default-disabled + known-unreachable. */
  producerUnreachableCodes: readonly string[]
  /** Families whose runtimeClosureStatus is CLOSED (currently zero). */
  verifiedRuntimeFamilies: readonly string[]
  /** Set differences (all sorted). */
  differences: {
    producerNotExpanded: readonly string[]
    expandedNotProducer: readonly string[]
    producerNotRegistryResolved: readonly string[]
    registryResolvedNotProducer: readonly string[]
    expandedNotRegistryResolved: readonly string[]
    registryResolvedNotExpanded: readonly string[]
  }
  counts: {
    registeredFamilyCount: number
    registryResolvedKeyCount: number
    expandedRuntimeCodeCount: number
    producerSupportedCodeCount: number
    runtimeReachableCodeCount: number
    deferredFamilyCount: number
    deferredCodeCount: number
    defaultDisabledCodeCount: number
    knownUnreachableCodeCount: number
    verifiedRuntimeFamilyCount: number
    expandedBySeverity: DiagnosticSeverityCounts
    producerBySeverity: DiagnosticSeverityCounts
    reachableBySeverity: DiagnosticSeverityCounts
    expandedBySeverityStrict: DiagnosticSeverityCounts
    producerBySeverityStrict: DiagnosticSeverityCounts
    reachableBySeverityStrict: DiagnosticSeverityCounts
  }
  invariants: {
    producerSubsetOfExpanded: boolean
    expandedMinusProducerEqualsDeferred: boolean
    reachablePlusUnreachableEqualsProducer: boolean
    noDuplicateExpandedCodes: boolean
    everyProducerCodeResolves: boolean
    everyExpandedCodeResolves: boolean
  }
}

function sorted(values: Iterable<string>): string[] {
  return [...values].sort()
}

function uniqueSorted(values: Iterable<string>): string[] {
  return sorted(new Set(values))
}

function severityOf(code: string, strict: boolean): 'error' | 'warning' | 'hint' {
  const meta = getRuleMeta(code)
  if (!meta) return 'hint'
  if (strict) {
    if (code.startsWith('LATENT_ATX_HEADING_MARKER')) return 'warning'
    if (code === 'HEADING_LEVEL_GAP' || code === 'HEADING_EMPTY_TEXT') return 'error'
  }
  return meta.presentationSeverity
}

function countBySeverity(codes: readonly string[], strict: boolean): DiagnosticSeverityCounts {
  const out: DiagnosticSeverityCounts = { error: 0, warning: 0, hint: 0 }
  for (const code of codes) out[severityOf(code, strict)]++
  return out
}

/**
 * Compute the complete code-set audit. Deterministic and side-effect free.
 * Every count is derived from the live registry + producer allow-list.
 */
export function computeDocumentDiagnosticCodeSetAudit(): DiagnosticCodeSetAudit {
  const families = Object.values(DOCUMENT_DIAGNOSTIC_RULE_REGISTRY)
  const registeredFamilyIds = sorted(families.map(meta => meta.familyId))
  const registryResolvedKeys = sorted(families.flatMap(meta => resolvedRuntimeCodesOf(meta)))
  const expandedRuntimeCodes = sorted(families.flatMap(meta => expandedRuntimeCodesOf(meta)))
  const producerSupportedCodes = sorted(PRODUCED_DIAGNOSTIC_CODES)

  const deferredFamilies = sorted(
    families.filter(meta => meta.implementationStatus === 'DEFERRED_BY_SPEC').map(meta => meta.familyId),
  )
  const deferredCodes = sorted(
    families
      .filter(meta => meta.implementationStatus === 'DEFERRED_BY_SPEC')
      .flatMap(meta => expandedRuntimeCodesOf(meta)),
  )
  const defaultDisabledCodes = sorted(
    families.filter(meta => !meta.defaultEnabled).flatMap(meta => expandedRuntimeCodesOf(meta)),
  )
  const knownUnreachableCodes = sorted(
    families.flatMap(meta => meta.knownUnreachableRuntimeCodes ?? []),
  )
  const producerUnreachableCodes = uniqueSorted([...defaultDisabledCodes, ...knownUnreachableCodes])
  const unreachableSet = new Set(producerUnreachableCodes)
  const runtimeReachableCodes = producerSupportedCodes.filter(code => !unreachableSet.has(code))
  const verifiedRuntimeFamilies = sorted(
    families.filter(meta => meta.runtimeClosureStatus === 'CLOSED').map(meta => meta.familyId),
  )

  const expandedSet = new Set(expandedRuntimeCodes)
  const producerSet = new Set(producerSupportedCodes)
  const resolvedSet = new Set(registryResolvedKeys)
  const producerNotExpanded = producerSupportedCodes.filter(code => !expandedSet.has(code))
  const expandedNotProducer = expandedRuntimeCodes.filter(code => !producerSet.has(code))
  const producerNotRegistryResolved = producerSupportedCodes.filter(code => !resolvedSet.has(code))
  const registryResolvedNotProducer = registryResolvedKeys.filter(code => !producerSet.has(code))
  const expandedNotRegistryResolved = expandedRuntimeCodes.filter(code => !resolvedSet.has(code))
  const registryResolvedNotExpanded = registryResolvedKeys.filter(code => !expandedSet.has(code))

  const everyExpandedCodeResolves = expandedRuntimeCodes.every(code => getRuleMeta(code) != null)
  const everyProducerCodeResolves = producerSupportedCodes.every(code => getRuleMeta(code) != null)
  const reachableSet = new Set(runtimeReachableCodes)
  const reachablePlusUnreachableEqualsProducer =
    runtimeReachableCodes.length + producerUnreachableCodes.length === producerSupportedCodes.length
    && producerSupportedCodes.every(code => reachableSet.has(code) || unreachableSet.has(code))

  return {
    registeredFamilyIds,
    registryResolvedKeys,
    expandedRuntimeCodes,
    producerSupportedCodes,
    runtimeReachableCodes,
    deferredFamilies,
    deferredCodes,
    defaultDisabledCodes,
    knownUnreachableCodes,
    producerUnreachableCodes,
    verifiedRuntimeFamilies,
    differences: {
      producerNotExpanded,
      expandedNotProducer,
      producerNotRegistryResolved,
      registryResolvedNotProducer,
      expandedNotRegistryResolved,
      registryResolvedNotExpanded,
    },
    counts: {
      registeredFamilyCount: registeredFamilyIds.length,
      registryResolvedKeyCount: registryResolvedKeys.length,
      expandedRuntimeCodeCount: expandedRuntimeCodes.length,
      producerSupportedCodeCount: producerSupportedCodes.length,
      runtimeReachableCodeCount: runtimeReachableCodes.length,
      deferredFamilyCount: deferredFamilies.length,
      deferredCodeCount: deferredCodes.length,
      defaultDisabledCodeCount: defaultDisabledCodes.length,
      knownUnreachableCodeCount: knownUnreachableCodes.length,
      verifiedRuntimeFamilyCount: verifiedRuntimeFamilies.length,
      expandedBySeverity: countBySeverity(expandedRuntimeCodes, false),
      producerBySeverity: countBySeverity(producerSupportedCodes, false),
      reachableBySeverity: countBySeverity(runtimeReachableCodes, false),
      expandedBySeverityStrict: countBySeverity(expandedRuntimeCodes, true),
      producerBySeverityStrict: countBySeverity(producerSupportedCodes, true),
      reachableBySeverityStrict: countBySeverity(runtimeReachableCodes, true),
    },
    invariants: {
      producerSubsetOfExpanded: producerNotExpanded.length === 0,
      expandedMinusProducerEqualsDeferred:
        expandedNotProducer.length === deferredCodes.length
        && expandedNotProducer.every(code => deferredCodes.includes(code)),
      reachablePlusUnreachableEqualsProducer,
      noDuplicateExpandedCodes: new Set(expandedRuntimeCodes).size === expandedRuntimeCodes.length,
      everyProducerCodeResolves,
      everyExpandedCodeResolves,
    },
  }
}
