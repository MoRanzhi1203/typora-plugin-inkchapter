/**
 * V5.14-R2 §P8 — Left-outline Heading Diagnostic Projection.
 *
 * The editor already paints a diagnostic marker; the LEFT OUTLINE must show the
 * SAME problem for the SAME heading. The outline is Typora-native, so the
 * projection is deliberately minimal:
 *
 *   • a lightweight low-saturation scribble surface over the item text
 *   • a 1.5–2px bottom underline
 *   • the ACTIVE occurrence may be slightly stronger
 *
 * It NEVER adds text, a badge, a chip, an icon, or mutates the native
 * `textContent` / row height — the projection is CLASS-ONLY and the visual comes
 * from the plugin's own stylesheet (`background` / `box-shadow`, never `border`
 * or `padding`, so the row height cannot change).
 *
 * HARD PRECONDITION: the projection may only exist on a COMMITTED
 * OutlineMappingSnapshot (P7). While the mapping is unsettled / the native root
 * was replaced / the revision is stale, nothing is painted at all.
 *
 * Pure contract: no DOM, no host state.
 */

export type OutlineDiagnosticSeverity = 'error' | 'warning' | 'info'

/**
 * §P8 — the ONE heading identity authority. The editor passive/active marker and
 * the outline projection MUST speak the SAME heading identity, and the editor's
 * identity is produced by the canonical heading-marker rule. Re-exporting that
 * exact rule here means the outline mapping (built from the canonical heading
 * key) and the diagnostic target (carrying the marker identity) can never drift.
 */
export { headingMarkerIdentity as canonicalHeadingMarkerIdentity } from './document-heading-diagnostic-marker-v5-12'

/** §6 — the ONE visual target key, byte-identical to the editor/drawer/closure key. */
export type OutlineDiagnosticTargetKey = string

export function buildOutlineDiagnosticTargetKey(input: {
  documentKey: string
  diagnosticId: string
  targetIndex: number
  stableHeadingIdentity: string
}): OutlineDiagnosticTargetKey {
  return `${input.documentKey}::${input.diagnosticId}::${input.targetIndex}::${input.stableHeadingIdentity}`
}

/** A heading diagnostic occurrence that WANTS an outline projection. */
export interface OutlineDiagnosticTargetInput {
  documentKey: string
  diagnosticId: string
  targetIndex: number
  stableHeadingIdentity: string
  severity: OutlineDiagnosticSeverity
  /** the ONLY occurrence that may be strengthened. */
  active: boolean
  /**
   * V5.14-R6 §15/§17 — the SAME semantic coverage mask the body uses
   * (NUMBER|GAP|TITLE for a numbered heading, TITLE otherwise). The outline
   * reprojects this mask into its OWN DOM coordinate space; body rects are never
   * copied across coordinate spaces.
   */
  coverageMask?: number
  /**
   * V5.14-R6.1 §14 — the SAME coverage POLICY resolved from the DiagnosticCode.
   * The outline reprojects it against its own DOM text; body rects are never copied.
   */
  coveragePolicy?: string
}

/** stableHeadingIdentity → the COMMITTED outline item it maps to. */
export interface OutlineHeadingMappingEntry {
  stableHeadingIdentity: string
  outlineItemIdentity: string
}

export interface OutlineDiagnosticProjection {
  documentKey: string
  diagnosticId: string
  targetIndex: number
  stableHeadingIdentity: string
  outlineItemIdentity: string
  severity: OutlineDiagnosticSeverity
  active: boolean
  passive: boolean
  layoutEpoch: number
  outlineGeneration: number
  sourceRevision: number
  key: OutlineDiagnosticTargetKey
}

export interface OutlineProjectionInput {
  /** the CURRENT document authority (a mismatch defers the whole projection). */
  documentKey: string
  sourceRevision: number
  layoutEpoch: number
  outlineGeneration: number
  /** P7 COMMITTED — false while WAITING_OUTLINE_SETTLE / invalidated. */
  mappingCommitted: boolean
  targets: readonly OutlineDiagnosticTargetInput[]
  mapping: readonly OutlineHeadingMappingEntry[]
}

export interface OutlineProjectionResult {
  state: 'COMMITTED' | 'DEFERRED'
  /** empty whenever `state` is DEFERRED — nothing may be painted. */
  projections: OutlineDiagnosticProjection[]
  /** targets whose heading has no committed outline item (never fabricated). */
  unmappedTargetKeys: OutlineDiagnosticTargetKey[]
  reason: string
}

/**
 * §P8 — the ONLY projection. Deferred whenever the mapping is not committed or
 * the authority moved on; a deferred projection is an EMPTY list by contract.
 */
export function projectOutlineDiagnostics(input: OutlineProjectionInput): OutlineProjectionResult {
  if (!input.mappingCommitted) {
    return { state: 'DEFERRED', projections: [], unmappedTargetKeys: [], reason: 'MAPPING_NOT_COMMITTED' }
  }
  const byIdentity = new Map<string, string>()
  for (const m of input.mapping) byIdentity.set(m.stableHeadingIdentity, m.outlineItemIdentity)

  const projections: OutlineDiagnosticProjection[] = []
  const unmappedTargetKeys: OutlineDiagnosticTargetKey[] = []
  for (const t of input.targets) {
    const outlineItemIdentity = byIdentity.get(t.stableHeadingIdentity)
    const key = buildOutlineDiagnosticTargetKey({
      documentKey: input.documentKey,
      diagnosticId: t.diagnosticId,
      targetIndex: t.targetIndex,
      stableHeadingIdentity: t.stableHeadingIdentity,
    })
    if (outlineItemIdentity == null) {
      unmappedTargetKeys.push(key)
      continue
    }
    projections.push({
      documentKey: input.documentKey,
      diagnosticId: t.diagnosticId,
      targetIndex: t.targetIndex,
      stableHeadingIdentity: t.stableHeadingIdentity,
      outlineItemIdentity,
      severity: t.severity,
      active: t.active,
      passive: !t.active,
      layoutEpoch: input.layoutEpoch,
      outlineGeneration: input.outlineGeneration,
      sourceRevision: input.sourceRevision,
      key,
    })
  }
  return { state: 'COMMITTED', projections, unmappedTargetKeys, reason: 'COMMITTED_MAPPING_PROJECTED' }
}

/** What the DOM currently carries for one projected marker. */
export interface OutlineDiagnosticMarkerFact {
  key: OutlineDiagnosticTargetKey
  documentKey: string
  diagnosticId: string
  targetIndex: number
  stableHeadingIdentity: string
  outlineItemIdentity: string
  severity: OutlineDiagnosticSeverity
  active: boolean
  outlineGeneration: number
  sourceRevision: number
}

export interface OutlineDiagnosticReconciliation {
  expectedCount: number
  actualCount: number
  missingKeys: OutlineDiagnosticTargetKey[]
  extraKeys: OutlineDiagnosticTargetKey[]
  duplicateKeys: OutlineDiagnosticTargetKey[]
  identityMismatchKeys: OutlineDiagnosticTargetKey[]
  targetIndexMismatchKeys: OutlineDiagnosticTargetKey[]
  staleGenerationKeys: OutlineDiagnosticTargetKey[]
  staleRevisionKeys: OutlineDiagnosticTargetKey[]
}

/**
 * §P8 — expected projections vs the markers actually applied to the outline.
 * `currentOutlineGeneration` / `currentSourceRevision` are the authority the
 * projection must still belong to; anything from another generation/revision is
 * a stale marker that must be cleaned, never silently kept.
 */
export function reconcileOutlineDiagnosticProjections(
  expected: readonly OutlineDiagnosticProjection[],
  actual: readonly OutlineDiagnosticMarkerFact[],
  currentOutlineGeneration: number,
  currentSourceRevision: number,
): OutlineDiagnosticReconciliation {
  const expectedByKey = new Map<OutlineDiagnosticTargetKey, OutlineDiagnosticProjection>()
  for (const e of expected) expectedByKey.set(e.key, e)

  const seen = new Map<OutlineDiagnosticTargetKey, OutlineDiagnosticMarkerFact>()
  const duplicateKeys: OutlineDiagnosticTargetKey[] = []
  for (const m of actual) {
    if (seen.has(m.key)) {
      if (!duplicateKeys.includes(m.key)) duplicateKeys.push(m.key)
      continue
    }
    seen.set(m.key, m)
  }

  const missingKeys: OutlineDiagnosticTargetKey[] = []
  const identityMismatchKeys: OutlineDiagnosticTargetKey[] = []
  const targetIndexMismatchKeys: OutlineDiagnosticTargetKey[] = []
  for (const e of expected) {
    const m = seen.get(e.key)
    if (!m) {
      missingKeys.push(e.key)
      continue
    }
    if (m.stableHeadingIdentity !== e.stableHeadingIdentity || m.outlineItemIdentity !== e.outlineItemIdentity) {
      identityMismatchKeys.push(e.key)
    }
    if (m.targetIndex !== e.targetIndex) targetIndexMismatchKeys.push(e.key)
  }

  const extraKeys: OutlineDiagnosticTargetKey[] = []
  const staleGenerationKeys: OutlineDiagnosticTargetKey[] = []
  const staleRevisionKeys: OutlineDiagnosticTargetKey[] = []
  for (const m of actual) {
    if (!expectedByKey.has(m.key)) extraKeys.push(m.key)
    if (m.outlineGeneration !== currentOutlineGeneration) {
      if (!staleGenerationKeys.includes(m.key)) staleGenerationKeys.push(m.key)
    }
    if (m.sourceRevision !== currentSourceRevision) {
      if (!staleRevisionKeys.includes(m.key)) staleRevisionKeys.push(m.key)
    }
  }

  return {
    expectedCount: expected.length,
    actualCount: actual.length,
    missingKeys,
    extraKeys,
    duplicateKeys,
    identityMismatchKeys,
    targetIndexMismatchKeys,
    staleGenerationKeys,
    staleRevisionKeys,
  }
}

// ── §P8 hard gates (all must be 0) ──────────────────────────────────────────

export const OUTLINE_DIAGNOSTIC_PROJECTION_V514R2_GATE_KEYS = [
  'outlineDiagnosticExpectedMarkerMissing',
  'outlineDiagnosticExtraMarker',
  'outlineDiagnosticDuplicateMarker',
  'outlineDiagnosticIdentityMismatch',
  'outlineDiagnosticTargetIndexMismatch',
  'outlineDiagnosticStaleGenerationMarker',
  'outlineDiagnosticStaleRevisionMarker',
  'outlineDiagnosticTextMutation',
  'outlineDiagnosticReasonText',
  'outlineDiagnosticBadge',
  'outlineDiagnosticPreSettlePaint',
] as const

export type OutlineDiagnosticProjectionV514R2GateKey = typeof OUTLINE_DIAGNOSTIC_PROJECTION_V514R2_GATE_KEYS[number]

export const OUTLINE_DIAGNOSTIC_PROJECTION_V514R2_GATE_LABELS: Readonly<Record<OutlineDiagnosticProjectionV514R2GateKey, string>> = {
  outlineDiagnosticExpectedMarkerMissing: 'OUTLINE_DIAGNOSTIC_EXPECTED_MARKER_MISSING_COUNT',
  outlineDiagnosticExtraMarker: 'OUTLINE_DIAGNOSTIC_EXTRA_MARKER_COUNT',
  outlineDiagnosticDuplicateMarker: 'OUTLINE_DIAGNOSTIC_DUPLICATE_MARKER_COUNT',
  outlineDiagnosticIdentityMismatch: 'OUTLINE_DIAGNOSTIC_IDENTITY_MISMATCH_COUNT',
  outlineDiagnosticTargetIndexMismatch: 'OUTLINE_DIAGNOSTIC_TARGET_INDEX_MISMATCH_COUNT',
  outlineDiagnosticStaleGenerationMarker: 'OUTLINE_DIAGNOSTIC_STALE_GENERATION_MARKER_COUNT',
  outlineDiagnosticStaleRevisionMarker: 'OUTLINE_DIAGNOSTIC_STALE_REVISION_MARKER_COUNT',
  outlineDiagnosticTextMutation: 'OUTLINE_DIAGNOSTIC_TEXT_MUTATION_COUNT',
  outlineDiagnosticReasonText: 'OUTLINE_DIAGNOSTIC_REASON_TEXT_COUNT',
  outlineDiagnosticBadge: 'OUTLINE_DIAGNOSTIC_BADGE_COUNT',
  outlineDiagnosticPreSettlePaint: 'OUTLINE_DIAGNOSTIC_PRE_SETTLE_PAINT_COUNT',
}

export type OutlineDiagnosticProjectionV514R2Counters = Record<OutlineDiagnosticProjectionV514R2GateKey, number>

export function createOutlineDiagnosticProjectionV514R2Counters(): OutlineDiagnosticProjectionV514R2Counters {
  return OUTLINE_DIAGNOSTIC_PROJECTION_V514R2_GATE_KEYS.reduce((acc, key) => {
    acc[key] = 0
    return acc
  }, {} as OutlineDiagnosticProjectionV514R2Counters)
}

/** §P8 — a reconciliation maps onto the frozen gate counters. */
export function outlineDiagnosticReconciliationToGateCounters(
  recon: OutlineDiagnosticReconciliation,
  extra: {
    textMutation: number
    reasonText: number
    badge: number
    preSettlePaint: number
  },
): OutlineDiagnosticProjectionV514R2Counters {
  return {
    outlineDiagnosticExpectedMarkerMissing: recon.missingKeys.length,
    outlineDiagnosticExtraMarker: recon.extraKeys.length,
    outlineDiagnosticDuplicateMarker: recon.duplicateKeys.length,
    outlineDiagnosticIdentityMismatch: recon.identityMismatchKeys.length,
    outlineDiagnosticTargetIndexMismatch: recon.targetIndexMismatchKeys.length,
    outlineDiagnosticStaleGenerationMarker: recon.staleGenerationKeys.length,
    outlineDiagnosticStaleRevisionMarker: recon.staleRevisionKeys.length,
    outlineDiagnosticTextMutation: Math.max(0, extra.textMutation),
    outlineDiagnosticReasonText: Math.max(0, extra.reasonText),
    outlineDiagnosticBadge: Math.max(0, extra.badge),
    outlineDiagnosticPreSettlePaint: Math.max(0, extra.preSettlePaint),
  }
}

export function formatOutlineDiagnosticProjectionV514R2GateReport(
  counters: Readonly<OutlineDiagnosticProjectionV514R2Counters>,
): string[] {
  return OUTLINE_DIAGNOSTIC_PROJECTION_V514R2_GATE_KEYS.map(
    key => `${OUTLINE_DIAGNOSTIC_PROJECTION_V514R2_GATE_LABELS[key]}=${counters[key] ?? 0}`,
  )
}

export function evaluateOutlineDiagnosticProjectionV514R2Gates(
  counters: Readonly<OutlineDiagnosticProjectionV514R2Counters>,
): { decision: 'PASS' | 'FAIL'; failedChecks: OutlineDiagnosticProjectionV514R2GateKey[] } {
  const failedChecks = OUTLINE_DIAGNOSTIC_PROJECTION_V514R2_GATE_KEYS.filter(key => (counters[key] ?? 0) !== 0)
  return { decision: failedChecks.length === 0 ? 'PASS' : 'FAIL', failedChecks }
}

export const OUTLINE_DIAGNOSTIC_PROJECTION_AUDIT_EVENT = 'OUTLINE-DIAGNOSTIC-PROJECTION-AUDIT'
