/**
 * V5.14-R2 §P7 — Outline mapping PRE-COMMIT settle gate.
 *
 * ROOT_P7_R2: the outline controller used to
 *
 *   compute mapping → apply numbering/decorations → post-verify → RETRY on change
 *
 * which let a TRANSIENT mis-mapped frame enter the real UI (Typora's native
 * outline is rebuilt asynchronously, so the item list can still be incomplete at
 * the moment the mapping is computed). The cardinality verdict existed only as
 * an audit line, never as an apply-time commit gate.
 *
 * The required order is:
 *
 *   PREPARE → BUILD_MAPPING_SNAPSHOT → PRECOMMIT_CARDINALITY_GATE
 *     ├─ FAIL/UNSTABLE → WAITING_OUTLINE_SETTLE (DOM_WRITE_COUNT = 0)
 *     └─ PASS → APPLY → POSTCOMMIT_VERIFY
 *
 * Pure contract: no DOM, no host state.
 */

export interface OutlineMappingSnapshot {
  documentKey: string
  sourceRevision: number
  /** The native outline mutation epoch the snapshot was measured in. */
  layoutEpoch: number
  outlineRootToken: string
  outlineGeneration: number

  expectedHeadingCount: number
  nativeOutlineItemCount: number
  matchedHeadingCount: number

  unmatchedHeadingCount: number
  unmatchedOutlineCount: number

  mappingFingerprint: string
  rootConnected: boolean
  rootVisible: boolean
}

export interface OutlineMappingSnapshotInput {
  documentKey: string
  sourceRevision: number
  layoutEpoch: number
  outlineRootToken: string | number | null
  outlineGeneration: number
  expectedHeadingCount: number
  nativeOutlineItemCount: number
  matchedHeadingCount: number
  unmatchedHeadingCount: number
  unmatchedOutlineCount: number
  rootConnected: boolean
  rootVisible: boolean
}

/** A stable, order-sensitive fingerprint of the mapping the snapshot commits. */
export function outlineMappingFingerprint(input: {
  documentKey: string
  sourceRevision: number
  outlineGeneration: number
  expectedHeadingCount: number
  nativeOutlineItemCount: number
  matchedHeadingCount: number
  unmatchedHeadingCount: number
  unmatchedOutlineCount: number
}): string {
  return [
    input.documentKey,
    input.sourceRevision,
    input.outlineGeneration,
    input.expectedHeadingCount,
    input.nativeOutlineItemCount,
    input.matchedHeadingCount,
    input.unmatchedHeadingCount,
    input.unmatchedOutlineCount,
  ].join('|')
}

export function buildOutlineMappingSnapshot(input: OutlineMappingSnapshotInput): OutlineMappingSnapshot {
  return {
    documentKey: input.documentKey,
    sourceRevision: input.sourceRevision,
    layoutEpoch: input.layoutEpoch,
    outlineRootToken: input.outlineRootToken == null ? '' : String(input.outlineRootToken),
    outlineGeneration: input.outlineGeneration,
    expectedHeadingCount: input.expectedHeadingCount,
    nativeOutlineItemCount: input.nativeOutlineItemCount,
    matchedHeadingCount: input.matchedHeadingCount,
    unmatchedHeadingCount: input.unmatchedHeadingCount,
    unmatchedOutlineCount: input.unmatchedOutlineCount,
    mappingFingerprint: outlineMappingFingerprint(input),
    rootConnected: input.rootConnected,
    rootVisible: input.rootVisible,
  }
}

export type OutlinePrecommitState = 'PASS' | 'WAITING_OUTLINE_SETTLE'

export interface OutlinePrecommitDecision {
  state: OutlinePrecommitState
  /** Every unmet precommit condition, in a stable order (empty on PASS). */
  unmetConditions: string[]
  reason: string
}

/**
 * §P7 — the ONLY precommit gate. APPLY may run additionally only when EVERY
 * condition holds; otherwise the state is WAITING_OUTLINE_SETTLE and the caller
 * MUST NOT write a single node.
 */
export function evaluateOutlinePrecommitGate(
  snapshot: OutlineMappingSnapshot,
  authority: { documentKey: string; sourceRevision: number },
): OutlinePrecommitDecision {
  const unmet: string[] = []
  if (snapshot.documentKey !== authority.documentKey) unmet.push('DOCUMENT_KEY_NOT_CURRENT')
  if (snapshot.sourceRevision !== authority.sourceRevision) unmet.push('SOURCE_REVISION_NOT_CURRENT')
  if (snapshot.expectedHeadingCount !== snapshot.nativeOutlineItemCount) unmet.push('EXPECTED_NATIVE_ITEM_COUNT_MISMATCH')
  if (snapshot.matchedHeadingCount !== snapshot.expectedHeadingCount) unmet.push('MATCHED_HEADING_COUNT_MISMATCH')
  if (snapshot.unmatchedHeadingCount !== 0) unmet.push('UNMATCHED_HEADING_PRESENT')
  if (snapshot.unmatchedOutlineCount !== 0) unmet.push('UNMATCHED_OUTLINE_PRESENT')
  if (!snapshot.rootConnected) unmet.push('ROOT_NOT_CONNECTED')
  if (!snapshot.rootVisible) unmet.push('ROOT_NOT_VISIBLE')
  return unmet.length === 0
    ? { state: 'PASS', unmetConditions: [], reason: 'MAPPING_SETTLED' }
    : { state: 'WAITING_OUTLINE_SETTLE', unmetConditions: unmet, reason: unmet.join(',') }
}

/** §P7 — the ONE pending-retry identity (at most one retry per this key). */
export function outlineMappingRetryKey(snapshot: {
  documentKey: string
  sourceRevision: number
  outlineGeneration: number
}): string {
  return `${snapshot.documentKey}::${snapshot.sourceRevision}::${snapshot.outlineGeneration}`
}

// ── §P7 hard gates (all must be 0) ──────────────────────────────────────────

export const OUTLINE_PRECOMMIT_V514R2_GATE_KEYS = [
  'outlineApplyBeforePrecommitVerify',
  'outlineUnstableMappingCommit',
  'outlineWaitingSettleDomWrite',
  'outlineCardinalityMismatchCommit',
  'outlineRootGenerationChangedDuringCommit',
  'outlineMappingRetryStorm',
  'outlineStaleRevisionCommit',
  'outlinePostcommitVerifyFailLeftDecoration',
] as const

export type OutlinePrecommitV514R2GateKey = typeof OUTLINE_PRECOMMIT_V514R2_GATE_KEYS[number]

export const OUTLINE_PRECOMMIT_V514R2_GATE_LABELS: Readonly<Record<OutlinePrecommitV514R2GateKey, string>> = {
  outlineApplyBeforePrecommitVerify: 'OUTLINE_APPLY_BEFORE_PRECOMMIT_VERIFY_COUNT',
  outlineUnstableMappingCommit: 'OUTLINE_UNSTABLE_MAPPING_COMMIT_COUNT',
  outlineWaitingSettleDomWrite: 'OUTLINE_WAITING_SETTLE_DOM_WRITE_COUNT',
  outlineCardinalityMismatchCommit: 'OUTLINE_CARDINALITY_MISMATCH_COMMIT_COUNT',
  outlineRootGenerationChangedDuringCommit: 'OUTLINE_ROOT_GENERATION_CHANGED_DURING_COMMIT_COUNT',
  outlineMappingRetryStorm: 'OUTLINE_MAPPING_RETRY_STORM_COUNT',
  outlineStaleRevisionCommit: 'OUTLINE_STALE_REVISION_COMMIT_COUNT',
  outlinePostcommitVerifyFailLeftDecoration: 'OUTLINE_POSTCOMMIT_VERIFY_FAIL_LEFT_DECORATION_COUNT',
}

export type OutlinePrecommitV514R2Counters = Record<OutlinePrecommitV514R2GateKey, number>

export function createOutlinePrecommitV514R2Counters(): OutlinePrecommitV514R2Counters {
  return OUTLINE_PRECOMMIT_V514R2_GATE_KEYS.reduce((acc, key) => {
    acc[key] = 0
    return acc
  }, {} as OutlinePrecommitV514R2Counters)
}

export function formatOutlinePrecommitV514R2GateReport(
  counters: Readonly<OutlinePrecommitV514R2Counters>,
): string[] {
  return OUTLINE_PRECOMMIT_V514R2_GATE_KEYS.map(
    key => `${OUTLINE_PRECOMMIT_V514R2_GATE_LABELS[key]}=${counters[key] ?? 0}`,
  )
}

export function evaluateOutlinePrecommitV514R2Gates(
  counters: Readonly<OutlinePrecommitV514R2Counters>,
): { decision: 'PASS' | 'FAIL'; failedChecks: OutlinePrecommitV514R2GateKey[] } {
  const failedChecks = OUTLINE_PRECOMMIT_V514R2_GATE_KEYS.filter(key => (counters[key] ?? 0) !== 0)
  return { decision: failedChecks.length === 0 ? 'PASS' : 'FAIL', failedChecks }
}

export const OUTLINE_PRECOMMIT_MAPPING_AUDIT_EVENT = 'OUTLINE-PRECOMMIT-MAPPING-AUDIT'
