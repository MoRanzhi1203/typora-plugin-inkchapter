/**
 * V5.14-R2 (P6) — Multi-target VISUAL CLOSURE reconciliation against the REAL rendered
 * passive markers.
 *
 * ROOT_P6_R2: the closure used to compare only
 *   `expanded target count` vs `resolver admitted count`
 * — i.e. it never looked at the markers that were actually painted. That yields
 *   • a false FAIL when the resolver declined a target but the marker exists;
 *   • a false PASS when the resolver admitted a target that was never painted;
 *   • duplicate / stale markers go undetected.
 *
 * This module reconciles `ExpectedVisualTargetKey[]` (from DiagnosticTargetProjection)
 * against `PassiveMarkerFact[]` read from the plugin's OWN overlay DOM, using ONE key:
 *
 *   `${documentKey}::${diagnosticId}::${targetIndex}::${stableIdentity}`
 *
 * Every view (Drawer row, editor passive/active marker, outline projection, locate
 * transaction, audit) references this same key — no module re-guesses a target.
 *
 * Pure contract: no DOM, no host state.
 */

export type DiagnosticVisualTargetKey = string

export interface ExpectedVisualTarget {
  visualTargetKey: DiagnosticVisualTargetKey
  documentKey: string
  diagnosticId: string
  targetIndex: number
  stableIdentity: string
  /** true when this expected target belongs to a multi-target diagnostic. */
  multiTarget: boolean
}

export interface PassiveMarkerFact {
  visualTargetKey: DiagnosticVisualTargetKey
  documentKey: string
  diagnosticId: string
  targetIndex: number
  stableIdentity: string
  /** passive markers are the ONLY ones that can satisfy an expectation. */
  role: 'passive' | 'active'
  connected: boolean
}

export function buildDiagnosticVisualTargetKey(input: {
  documentKey: string
  diagnosticId: string
  targetIndex: number
  stableIdentity: string
}): DiagnosticVisualTargetKey {
  return `${input.documentKey}::${input.diagnosticId}::${input.targetIndex}::${input.stableIdentity}`
}

export interface VisualClosureReconciliation {
  expectedCount: number
  actualCount: number
  missingKeys: DiagnosticVisualTargetKey[]
  extraKeys: DiagnosticVisualTargetKey[]
  duplicateKeys: DiagnosticVisualTargetKey[]
  identityMismatchKeys: DiagnosticVisualTargetKey[]
  targetIndexMismatchKeys: DiagnosticVisualTargetKey[]
  staleDocumentKeys: DiagnosticVisualTargetKey[]
  /** expected keys that belong to a multi-target diagnostic and are missing. */
  multiTargetMissingCount: number
  /** the ACTIVE occurrence's keys — its passive fill is suspended by R9, so these
   *  keys may be satisfied by their ACTIVE marker (at most one heading is active). */
  activeVisualTargetKeys: DiagnosticVisualTargetKey[]
  activeSatisfied: boolean
}

/**
 * §P6 — the ONE reconciliation. `actualPassiveMarkers` is read from the real overlay DOM
 * (never from the resolver), so a marker that was never painted cannot pass.
 *
 * `activeVisualTargetKeys` is the (optional) active occurrence's key set: R9 suspends the
 * passive fill of the active heading, so those keys may be satisfied by ACTIVE facts.
 * Every other expected key must be satisfied by a PASSIVE fact — an active fact never
 * substitutes a passive one.
 */
export function reconcileExpectedVisualTargets(
  expected: readonly ExpectedVisualTarget[],
  actualPassiveMarkers: readonly PassiveMarkerFact[],
  currentDocumentKey: string | null,
  activeVisualTargetKeys: ReadonlySet<DiagnosticVisualTargetKey> | null = null,
): VisualClosureReconciliation {
  const expectedByKey = new Map<DiagnosticVisualTargetKey, ExpectedVisualTarget>()
  for (const e of expected) expectedByKey.set(e.visualTargetKey, e)

  const connected = actualPassiveMarkers.filter(m => m.connected)
  const passive = connected.filter(m => m.role === 'passive')
  const activeKeys = new Set(connected.filter(m => m.role === 'active').map(m => m.visualTargetKey))
  const passiveByKey = new Map<DiagnosticVisualTargetKey, PassiveMarkerFact>()
  const duplicateKeys: DiagnosticVisualTargetKey[] = []
  for (const m of passive) {
    if (passiveByKey.has(m.visualTargetKey)) {
      if (!duplicateKeys.includes(m.visualTargetKey)) duplicateKeys.push(m.visualTargetKey)
      continue
    }
    passiveByKey.set(m.visualTargetKey, m)
  }

  const missingKeys: DiagnosticVisualTargetKey[] = []
  const identityMismatchKeys: DiagnosticVisualTargetKey[] = []
  const targetIndexMismatchKeys: DiagnosticVisualTargetKey[] = []
  let multiTargetMissingCount = 0
  for (const e of expected) {
    const m = passiveByKey.get(e.visualTargetKey)
    if (!m) {
      // the suspended-active key is satisfied by its ACTIVE marker instead
      if (activeVisualTargetKeys != null
        && activeVisualTargetKeys.has(e.visualTargetKey)
        && activeKeys.has(e.visualTargetKey)) {
        continue
      }
      missingKeys.push(e.visualTargetKey)
      if (e.multiTarget) multiTargetMissingCount++
      continue
    }
    if (m.stableIdentity !== e.stableIdentity) identityMismatchKeys.push(e.visualTargetKey)
    if (m.targetIndex !== e.targetIndex) targetIndexMismatchKeys.push(e.visualTargetKey)
  }

  const extraKeys: DiagnosticVisualTargetKey[] = []
  const staleDocumentKeys: DiagnosticVisualTargetKey[] = []
  for (const m of passive) {
    if (!expectedByKey.has(m.visualTargetKey)) extraKeys.push(m.visualTargetKey)
    if (currentDocumentKey != null && m.documentKey !== currentDocumentKey) {
      if (!staleDocumentKeys.includes(m.visualTargetKey)) staleDocumentKeys.push(m.visualTargetKey)
    }
  }

  return {
    expectedCount: expected.length,
    actualCount: passive.length,
    missingKeys,
    extraKeys,
    duplicateKeys,
    identityMismatchKeys,
    targetIndexMismatchKeys,
    staleDocumentKeys,
    multiTargetMissingCount,
    activeVisualTargetKeys: activeVisualTargetKeys != null ? [...activeVisualTargetKeys] : [],
    activeSatisfied: activeVisualTargetKeys != null
      && activeVisualTargetKeys.size > 0
      && [...activeVisualTargetKeys].every(k => activeKeys.has(k)),
  }
}

/** §P6 — map a reconciliation onto the frozen gate counters. */
export function visualClosureReconciliationToGateCounters(
  recon: VisualClosureReconciliation,
  locatableHeadingWithoutVisualTarget: number,
): VisualClosureTargetV514R2Counters {
  return {
    expectedPassiveMarkerMissing: recon.missingKeys.length,
    unexpectedPassiveMarkerExtra: recon.extraKeys.length,
    duplicatePassiveMarker: recon.duplicateKeys.length,
    passiveMarkerIdentityMismatch: recon.identityMismatchKeys.length,
    passiveMarkerTargetIndexMismatch: recon.targetIndexMismatchKeys.length,
    passiveMarkerStaleDocument: recon.staleDocumentKeys.length,
    locatableHeadingDiagnosticWithoutVisualTarget: Math.max(0, locatableHeadingWithoutVisualTarget),
    headingMultiTargetPassiveMissing: recon.multiTargetMissingCount,
  }
}

// ── P6 §14 — the closure reconciliation hard gates (all must be 0) ─────────

export const VISUAL_CLOSURE_TARGET_V514R2_GATE_KEYS = [
  'expectedPassiveMarkerMissing',
  'unexpectedPassiveMarkerExtra',
  'duplicatePassiveMarker',
  'passiveMarkerIdentityMismatch',
  'passiveMarkerTargetIndexMismatch',
  'passiveMarkerStaleDocument',
  'locatableHeadingDiagnosticWithoutVisualTarget',
  'headingMultiTargetPassiveMissing',
] as const

export type VisualClosureTargetV514R2GateKey = typeof VISUAL_CLOSURE_TARGET_V514R2_GATE_KEYS[number]

export const VISUAL_CLOSURE_TARGET_V514R2_GATE_LABELS: Readonly<Record<VisualClosureTargetV514R2GateKey, string>> = {
  expectedPassiveMarkerMissing: 'EXPECTED_PASSIVE_MARKER_MISSING_COUNT',
  unexpectedPassiveMarkerExtra: 'UNEXPECTED_PASSIVE_MARKER_EXTRA_COUNT',
  duplicatePassiveMarker: 'DUPLICATE_PASSIVE_MARKER_COUNT',
  passiveMarkerIdentityMismatch: 'PASSIVE_MARKER_IDENTITY_MISMATCH_COUNT',
  passiveMarkerTargetIndexMismatch: 'PASSIVE_MARKER_TARGET_INDEX_MISMATCH_COUNT',
  passiveMarkerStaleDocument: 'PASSIVE_MARKER_STALE_DOCUMENT_COUNT',
  locatableHeadingDiagnosticWithoutVisualTarget: 'LOCATABLE_HEADING_DIAGNOSTIC_WITHOUT_VISUAL_TARGET_COUNT',
  headingMultiTargetPassiveMissing: 'HEADING_MULTI_TARGET_PASSIVE_MISSING_COUNT',
}

export type VisualClosureTargetV514R2Counters = Record<VisualClosureTargetV514R2GateKey, number>

export function createVisualClosureTargetV514R2Counters(): VisualClosureTargetV514R2Counters {
  return VISUAL_CLOSURE_TARGET_V514R2_GATE_KEYS.reduce((acc, k) => {
    acc[k] = 0
    return acc
  }, {} as VisualClosureTargetV514R2Counters)
}

export function formatVisualClosureTargetV514R2GateReport(
  counters: Readonly<VisualClosureTargetV514R2Counters>,
): string[] {
  return VISUAL_CLOSURE_TARGET_V514R2_GATE_KEYS.map(
    k => `${VISUAL_CLOSURE_TARGET_V514R2_GATE_LABELS[k]}=${counters[k] ?? 0}`,
  )
}

export function evaluateVisualClosureTargetV514R2Gates(
  counters: Readonly<VisualClosureTargetV514R2Counters>,
): { decision: 'PASS' | 'FAIL'; failedChecks: VisualClosureTargetV514R2GateKey[] } {
  const failedChecks = VISUAL_CLOSURE_TARGET_V514R2_GATE_KEYS.filter(k => (counters[k] ?? 0) !== 0)
  return { decision: failedChecks.length === 0 ? 'PASS' : 'FAIL', failedChecks }
}

export const VISUAL_CLOSURE_TARGET_AUDIT_EVENT = 'DOCUMENT-DIAGNOSTIC-VISUAL-CLOSURE-TARGET-AUDIT'
