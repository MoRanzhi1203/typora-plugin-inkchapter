/**
 * V1 — Document Utility Mutation Provenance (pure contract).
 *
 * THE DEFECT (proved by the real stress runtime, app-1790788691539.log):
 *
 *   EDITOR-MUTATION-CLASSIFICATION mutationShape=NONE  (0 paragraphs added/removed)
 *     → CAPTION-HEADING-AUTHORITY-GATE triggerReason=mutation:CONTENT_RELEVANT
 *     → CODE-CANDIDATE-SUMMARY × 4490  (rawPreCount=316 canonicalCodeTargetCount=212, 2-3 ms each)
 *     → CAPTION-SCAN × 36 / CAPTION-RENDER-PLAN × 36
 *     → RENDER-ATTEMPT × 7632
 *     → HEADING-*-AUDIT × ~1300
 *
 *   PERF_ROOT_1 = the plugin's OWN presentation DOM writes were never separated
 *                 from real user content mutations.
 *   PERF_ROOT_2 = mutationShape=NONE could still be routed as CONTENT_RELEVANT.
 *   PERF_ROOT_3 = a diagnostic click's Active visual write re-woke the semantic
 *                 pipeline through the editor MutationObserver.
 *   PERF_ROOT_8 = the same semantic state key could repeat the expensive pass.
 *
 * Pure: no DOM mutation, no host state.
 */

// ── §31 — the provenance audit ─────────────────────────────

export const EDITOR_MUTATION_PROVENANCE_AUDIT_EVENT = 'EDITOR-MUTATION-PROVENANCE-AUDIT'
export const DOCUMENT_SEMANTIC_RECONCILE_AUDIT_EVENT = 'DOCUMENT-SEMANTIC-RECONCILE-AUDIT'
export const CAPTION_PLAN_DIFF_AUDIT_EVENT = 'CAPTION-PLAN-DIFF-AUDIT'
export const DOCUMENT_DIAGNOSTIC_VISUAL_DIRTY_SET_AUDIT_EVENT = 'DOCUMENT-DIAGNOSTIC-VISUAL-DIRTY-SET-AUDIT'
export const DOCUMENT_UTILITY_PERF_SUMMARY_EVENT = 'DOCUMENT-UTILITY-PERF-SUMMARY'

// ── §4 — the provenance taxonomy ──────────────────────────

export type MutationProvenance =
  | 'USER_CONTENT'
  | 'PLUGIN_PRESENTATION'
  | 'LAYOUT_ONLY'
  | 'UNKNOWN'

export type MutationShapeV1 =
  | 'NONE'
  | 'REPLACE_1_TO_1'
  | 'SPLIT_1_TO_2'
  | 'MERGE_2_TO_1'
  | 'COMPLEX'

/** The InkChapter-owned presentation markers (single source of truth). */
export const INKCHAPTER_OWNED_ATTRIBUTES = [
  'data-inkchapter-ui-root',
  'data-inkchapter-caption',
  'data-ink-active-diagnostic-id',
  'data-ink-heading-id',
  'data-ink-target-key',
  'data-ink-diagnostic-active',
  'data-ink-layout-epoch',
  'data-ink-geometry-generation',
] as const

export const INKCHAPTER_OWNED_CLASS_PREFIX = 'inkchapter-'

/** §5 — is this node (or an ancestor) an InkChapter presentation node? */
export function isInkChapterOwnedNode(node: Node | null | undefined): boolean {
  if (node == null) return false
  const element = node instanceof Element
    ? node
    : (node.parentElement ?? null)
  if (element == null) return false
  if (element.closest('[data-inkchapter-ui-root], [data-inkchapter-caption]') != null) return true
  if (element.closest('[data-ink-heading-id], [data-ink-target-key]') != null) return true
  let cursor: Element | null = element
  let depth = 0
  while (cursor != null && depth++ < 12) {
    const cls = typeof cursor.className === 'string' ? cursor.className : ''
    if (cls.split(/\s+/).some(token => token.startsWith(INKCHAPTER_OWNED_CLASS_PREFIX))) return true
    cursor = cursor.parentElement
  }
  return false
}

/** §5.3 — the class tokens a mutation added/removed on an element. */
export function classNameDelta(input: {
  previous: string | null
  current: string | null
}): { added: string[]; removed: string[] } {
  const split = (v: string | null): string[] =>
    (v ?? '').split(/\s+/).map(t => t.trim()).filter(t => t !== '')
  const before = new Set(split(input.previous))
  const after = new Set(split(input.current))
  return {
    added: [...after].filter(t => !before.has(t)),
    removed: [...before].filter(t => !after.has(t)),
  }
}

export interface MutationRecordLike {
  type: string
  target: Node | null
  addedNodes: ArrayLike<Node>
  removedNodes: ArrayLike<Node>
  attributeName?: string | null
  /** the element's class BEFORE the attribute mutation (host-provided). */
  previousClassName?: string | null
}

export interface MutationProvenanceCounts {
  recordCount: number
  childListCount: number
  attributeCount: number
  characterDataCount: number
  pluginOwnedAddedCount: number
  pluginOwnedRemovedCount: number
  pluginOwnedTextCount: number
  pluginOwnedAttributeDeltaCount: number
  userContentMutationCount: number
}

export interface MutationProvenanceResult {
  provenance: MutationProvenance
  counts: MutationProvenanceCounts
  reason: string
}

/**
 * §4/§5 — the ONE provenance authority. Everything that cannot be PROVEN to be
 * plugin presentation is `UNKNOWN` (fail-safe, never silently dropped).
 */
export function classifyMutationProvenance(
  records: ReadonlyArray<MutationRecordLike>,
): MutationProvenanceResult {
  const counts: MutationProvenanceCounts = {
    recordCount: records.length,
    childListCount: 0,
    attributeCount: 0,
    characterDataCount: 0,
    pluginOwnedAddedCount: 0,
    pluginOwnedRemovedCount: 0,
    pluginOwnedTextCount: 0,
    pluginOwnedAttributeDeltaCount: 0,
    userContentMutationCount: 0,
  }
  let userContent = 0
  let pluginOwned = 0
  let layoutOnly = 0
  let unknown = 0

  for (const record of records) {
    const added = Array.from(record.addedNodes ?? [])
    const removed = Array.from(record.removedNodes ?? [])
    const targetOwned = isInkChapterOwnedNode(record.target)

    if (record.type === 'childList') {
      counts.childListCount++
      const allAddedOwned = added.length > 0 && added.every(n => isInkChapterOwnedNode(n))
      const allRemovedOwned = removed.length > 0 && removed.every(n => isInkChapterOwnedNode(n))
      const everyNodeOwned = (added.length + removed.length) > 0
        && added.every(n => isInkChapterOwnedNode(n))
        && removed.every(n => isInkChapterOwnedNode(n))
      counts.pluginOwnedAddedCount += added.filter(n => isInkChapterOwnedNode(n)).length
      counts.pluginOwnedRemovedCount += removed.filter(n => isInkChapterOwnedNode(n)).length
      if (everyNodeOwned || ((added.length === 0) && allRemovedOwned) || ((removed.length === 0) && allAddedOwned)) {
        pluginOwned++
        continue
      }
      if (targetOwned && added.length === 0 && removed.length === 0) {
        pluginOwned++
        continue
      }
      if (added.length + removed.length === 0) {
        layoutOnly++
        continue
      }
      counts.userContentMutationCount++
      userContent++
      continue
    }

    if (record.type === 'characterData') {
      counts.characterDataCount++
      if (targetOwned) {
        counts.pluginOwnedTextCount++
        pluginOwned++
        continue
      }
      counts.userContentMutationCount++
      userContent++
      continue
    }

    if (record.type === 'attributes') {
      counts.attributeCount++
      // §5.3 — an InkChapter-only class delta on a Typora host is presentation.
      if (record.attributeName === 'class' && targetOwned) {
        const delta = classNameDelta({
          previous: record.previousClassName ?? null,
          current: record.target instanceof Element ? record.target.className : null,
        })
        const onlyPluginTokens = delta.added.every(t => t.startsWith(INKCHAPTER_OWNED_CLASS_PREFIX))
          && delta.removed.every(t => t.startsWith(INKCHAPTER_OWNED_CLASS_PREFIX))
        if (onlyPluginTokens) {
          counts.pluginOwnedAttributeDeltaCount++
          pluginOwned++
          continue
        }
        counts.userContentMutationCount++
        userContent++
        continue
      }
      const attr = record.attributeName ?? ''
      if (attr.startsWith('data-ink') || attr.startsWith('data-inkchapter') || attr === 'aria-hidden') {
        counts.pluginOwnedAttributeDeltaCount++
        pluginOwned++
        continue
      }
      counts.userContentMutationCount++
      userContent++
      continue
    }

    unknown++
  }

  // §6 — fail-safe: a batch is PLUGIN_PRESENTATION only when EVERY record is
  // provably plugin-owned presentation. Any user content wins over presentation.
  if (userContent > 0) {
    return { provenance: 'USER_CONTENT', counts, reason: 'USER_CONTENT_RECORD_PRESENT' }
  }
  if (pluginOwned > 0 && pluginOwned === records.length) {
    return { provenance: 'PLUGIN_PRESENTATION', counts, reason: 'ALL_RECORDS_PLUGIN_OWNED_PRESENTATION' }
  }
  if (layoutOnly > 0 && layoutOnly === records.length) {
    return { provenance: 'LAYOUT_ONLY', counts, reason: 'CHILDLIST_WITHOUT_NODES' }
  }
  if (pluginOwned > 0) {
    return { provenance: 'PLUGIN_PRESENTATION', counts, reason: 'PLUGIN_OWNED_AND_NON_CONTENT_RECORDS' }
  }
  return { provenance: 'UNKNOWN', counts, reason: 'UNPROVEN_MUTATION_SOURCE' }
}

// ── §7 — the paragraph-level mutation shape ───────────────

/**
 * §7 — does this batch touch a CAPTION/NUMBERING business host? Only a batch
 * that provably touches NO host (and is not plugin presentation) may be short
 * circuited on an unchanged semantic state, so a real edit (image alt, code
 * fence text, heading text, table) can never be optimized away.
 */
export function mutationTouchesBusinessHost(records: ReadonlyArray<MutationRecordLike>): boolean {
  const hostSelector = 'table, figure, img, pre, h1, h2, h3, h4, h5, h6, .md-fences, .md-math-block'
  const isHost = (node: Node | null): boolean => {
    if (node == null) return false
    const el = node instanceof Element ? node : node.parentElement
    if (el == null) return false
    if (el.matches(hostSelector)) return true
    return el.closest(hostSelector) != null
  }
  for (const record of records) {
    if (isHost(record.target)) return true
    for (const node of Array.from(record.addedNodes ?? [])) if (isHost(node)) return true
    for (const node of Array.from(record.removedNodes ?? [])) if (isHost(node)) return true
  }
  return false
}

/** §7 — the paragraph-level mutation shape the caption observer computes. */
export function computeCaptionObserverMutationShape(
  records: ReadonlyArray<MutationRecordLike>,
): MutationShapeV1 {
  let removed = 0
  let added = 0
  for (const record of records) {
    if (record.type !== 'childList') continue
    for (const node of Array.from(record.removedNodes ?? [])) {
      if (node instanceof Element && node.tagName === 'P') removed++
    }
    for (const node of Array.from(record.addedNodes ?? [])) {
      if (node instanceof Element && node.tagName === 'P') added++
    }
  }
  if (removed === 0 && added === 0) return 'NONE'
  if (removed === 1 && added === 1) return 'REPLACE_1_TO_1'
  if (removed === 1 && added === 2) return 'SPLIT_1_TO_2'
  if (removed === 2 && added === 1) return 'MERGE_2_TO_1'
  return 'COMPLEX'
}

// ── §7/§15 — the semantic reconcile decision ──────────────

export interface SemanticStateKeyParts {
  documentKey: string
  semanticRevision: number
  editorStructureEpoch: number
  canonicalHostFingerprint: string
}

/** §15 — the ONE expensive-pass key. */
export function buildExpensiveReconcileKey(parts: SemanticStateKeyParts): string {
  return [
    parts.documentKey,
    String(parts.semanticRevision),
    String(parts.editorStructureEpoch),
    parts.canonicalHostFingerprint,
  ].join('|')
}

export interface SemanticReconcileDecisionInput {
  provenance: MutationProvenance
  mutationShape: MutationShapeV1
  sourceRevisionChanged: boolean
  canonicalStructureChanged: boolean
  semanticFingerprintChanged: boolean
  stateKey: string
  previousStateKey: string | null
  /** a real user gesture (Drawer click / Active switch) owns this batch. */
  pluginInteractionActive: boolean
  /** §7 — the batch touches a caption/numbering business host. */
  businessHostTouched: boolean
}

export interface SemanticReconcileDecision {
  semanticReconcileAllowed: boolean
  decision:
    | 'NO_SEMANTIC_RECONCILE'
    | 'PLUGIN_PRESENTATION_SHORT_CIRCUIT'
    | 'NOOP_DUPLICATE_SEMANTIC_STATE'
    | 'SEMANTIC_RECONCILE_ALLOWED'
  reason: string
}

/**
 * §7/§8/§9/§15 — the ONE routing decision. Presentation-only mutations NEVER
 * reach the semantic pipeline; a NONE mutation with an unchanged semantic state
 * is a HARD short circuit; a repeated state key allows at most ONE expensive
 * pass.
 */
export function evaluateSemanticReconcileDecision(
  input: SemanticReconcileDecisionInput,
): SemanticReconcileDecision {
  if (input.provenance === 'PLUGIN_PRESENTATION') {
    return {
      semanticReconcileAllowed: false,
      decision: 'PLUGIN_PRESENTATION_SHORT_CIRCUIT',
      reason: 'PLUGIN_OWNED_PRESENTATION_MUTATION',
    }
  }
  if (input.provenance === 'LAYOUT_ONLY' && !input.semanticFingerprintChanged) {
    return {
      semanticReconcileAllowed: false,
      decision: 'PLUGIN_PRESENTATION_SHORT_CIRCUIT',
      reason: 'LAYOUT_ONLY_MUTATION_WITHOUT_SEMANTIC_CHANGE',
    }
  }
  if (input.mutationShape === 'NONE'
    && !input.businessHostTouched
    && !input.sourceRevisionChanged
    && !input.canonicalStructureChanged
    && !input.semanticFingerprintChanged) {
    return {
      semanticReconcileAllowed: false,
      decision: 'NO_SEMANTIC_RECONCILE',
      reason: 'NONE_MUTATION_WITH_UNCHANGED_SEMANTIC_STATE',
    }
  }
  const sameStateKey = input.previousStateKey != null && input.previousStateKey === input.stateKey
  if (sameStateKey
    && !input.businessHostTouched
    && !input.sourceRevisionChanged
    && !input.canonicalStructureChanged) {
    return {
      semanticReconcileAllowed: false,
      decision: 'NOOP_DUPLICATE_SEMANTIC_STATE',
      reason: 'SAME_EXPENSIVE_RECONCILE_STATE_KEY',
    }
  }
  return {
    semanticReconcileAllowed: true,
    decision: 'SEMANTIC_RECONCILE_ALLOWED',
    reason: input.provenance === 'USER_CONTENT'
      ? 'USER_CONTENT_MUTATION'
      : 'SEMANTIC_STATE_CHANGED',
  }
}

// ── §35 — the FATAL performance gates (all must be 0) ─────

export const DOCUMENT_UTILITY_PERF_GATE_KEYS = [
  'pluginPresentationMutationTriggeredCaptionReconcile',
  'pluginPresentationMutationTriggeredCaptionScan',
  'pluginPresentationMutationTriggeredCodeDiscovery',
  'pluginPresentationMutationTriggeredDocumentDiagnosticRescan',
  'noneMutationTriggeredContentReconcile',
  'noneMutationTriggeredCaptionScan',
  'noneMutationTriggeredCodeCandidateScan',
  'diagnosticClickTriggeredCaptionFullScan',
  'diagnosticClickTriggeredCodeCandidateScan',
  'diagnosticClickTriggeredSemanticRebuild',
  'duplicateExpensiveReconcileSameStateKey',
  'unchangedCaptionPlanRenderLoopEntry',
  'unchangedCaptionPlanRenderAttempt',
  'activeSwitchFullHeadingRebuild',
  'activeSwitchNonDirtyHeadingMeasure',
  'passTargetVerboseAudit',
  'passTargetRectJsonLog',
  'duplicatePerTargetAuditSameGeneration',
] as const

export type DocumentUtilityPerfGateKey = typeof DOCUMENT_UTILITY_PERF_GATE_KEYS[number]

export const DOCUMENT_UTILITY_PERF_GATE_LABELS: Readonly<Record<DocumentUtilityPerfGateKey, string>> = {
  pluginPresentationMutationTriggeredCaptionReconcile: 'PLUGIN_PRESENTATION_MUTATION_TRIGGERED_CAPTION_RECONCILE_COUNT',
  pluginPresentationMutationTriggeredCaptionScan: 'PLUGIN_PRESENTATION_MUTATION_TRIGGERED_CAPTION_SCAN_COUNT',
  pluginPresentationMutationTriggeredCodeDiscovery: 'PLUGIN_PRESENTATION_MUTATION_TRIGGERED_CODE_DISCOVERY_COUNT',
  pluginPresentationMutationTriggeredDocumentDiagnosticRescan: 'PLUGIN_PRESENTATION_MUTATION_TRIGGERED_DOCUMENT_DIAGNOSTIC_RESCAN_COUNT',
  noneMutationTriggeredContentReconcile: 'NONE_MUTATION_TRIGGERED_CONTENT_RECONCILE_COUNT',
  noneMutationTriggeredCaptionScan: 'NONE_MUTATION_TRIGGERED_CAPTION_SCAN_COUNT',
  noneMutationTriggeredCodeCandidateScan: 'NONE_MUTATION_TRIGGERED_CODE_CANDIDATE_SCAN_COUNT',
  diagnosticClickTriggeredCaptionFullScan: 'DIAGNOSTIC_CLICK_TRIGGERED_CAPTION_FULL_SCAN_COUNT',
  diagnosticClickTriggeredCodeCandidateScan: 'DIAGNOSTIC_CLICK_TRIGGERED_CODE_CANDIDATE_SCAN_COUNT',
  diagnosticClickTriggeredSemanticRebuild: 'DIAGNOSTIC_CLICK_TRIGGERED_SEMANTIC_REBUILD_COUNT',
  duplicateExpensiveReconcileSameStateKey: 'DUPLICATE_EXPENSIVE_RECONCILE_SAME_STATE_KEY_COUNT',
  unchangedCaptionPlanRenderLoopEntry: 'UNCHANGED_CAPTION_PLAN_RENDER_LOOP_ENTRY_COUNT',
  unchangedCaptionPlanRenderAttempt: 'UNCHANGED_CAPTION_PLAN_RENDER_ATTEMPT_COUNT',
  activeSwitchFullHeadingRebuild: 'ACTIVE_SWITCH_FULL_HEADING_REBUILD_COUNT',
  activeSwitchNonDirtyHeadingMeasure: 'ACTIVE_SWITCH_NON_DIRTY_HEADING_MEASURE_COUNT',
  passTargetVerboseAudit: 'PASS_TARGET_VERBOSE_AUDIT_COUNT',
  passTargetRectJsonLog: 'PASS_TARGET_RECT_JSON_LOG_COUNT',
  duplicatePerTargetAuditSameGeneration: 'DUPLICATE_PER_TARGET_AUDIT_SAME_GENERATION_COUNT',
}

export type DocumentUtilityPerfCounters = Record<DocumentUtilityPerfGateKey, number>

export function createDocumentUtilityPerfCounters(): DocumentUtilityPerfCounters {
  return DOCUMENT_UTILITY_PERF_GATE_KEYS.reduce((acc, k) => {
    acc[k] = 0
    return acc
  }, {} as DocumentUtilityPerfCounters)
}

export function formatDocumentUtilityPerfGateReport(
  counters: Readonly<DocumentUtilityPerfCounters>,
): string[] {
  return DOCUMENT_UTILITY_PERF_GATE_KEYS.map(k => `${DOCUMENT_UTILITY_PERF_GATE_LABELS[k]}=${counters[k] ?? 0}`)
}

export function evaluateDocumentUtilityPerfGates(
  counters: Readonly<DocumentUtilityPerfCounters>,
): { decision: 'PASS' | 'FAIL'; failedChecks: DocumentUtilityPerfGateKey[] } {
  const failedChecks = DOCUMENT_UTILITY_PERF_GATE_KEYS.filter(k => (counters[k] ?? 0) !== 0)
  return { decision: failedChecks.length === 0 ? 'PASS' : 'FAIL', failedChecks }
}

// ── §36 — the POSITIVE coverage (scenario proof only) ─────

export const DOCUMENT_UTILITY_PERF_COVERAGE_KEYS = [
  'userContentMutationSemanticReconcile',
  'userContentMutationCaptionScan',
  'pluginPresentationMutationShortCircuit',
  'noneMutationShortCircuit',
  'codeCandidateCacheHit',
  'captionUnchangedPlanNoop',
  'diagnosticActiveSwitchIncrementalVisual',
  'summaryPerfAudit',
] as const

export type DocumentUtilityPerfCoverageKey = typeof DOCUMENT_UTILITY_PERF_COVERAGE_KEYS[number]

export const DOCUMENT_UTILITY_PERF_COVERAGE_LABELS: Readonly<Record<DocumentUtilityPerfCoverageKey, string>> = {
  userContentMutationSemanticReconcile: 'USER_CONTENT_MUTATION_SEMANTIC_RECONCILE_COUNT',
  userContentMutationCaptionScan: 'USER_CONTENT_MUTATION_CAPTION_SCAN_COUNT',
  pluginPresentationMutationShortCircuit: 'PLUGIN_PRESENTATION_MUTATION_SHORT_CIRCUIT_COUNT',
  noneMutationShortCircuit: 'NONE_MUTATION_SHORT_CIRCUIT_COUNT',
  codeCandidateCacheHit: 'CODE_CANDIDATE_CACHE_HIT_COUNT',
  captionUnchangedPlanNoop: 'CAPTION_UNCHANGED_PLAN_NOOP_COUNT',
  diagnosticActiveSwitchIncrementalVisual: 'DIAGNOSTIC_ACTIVE_SWITCH_INCREMENTAL_VISUAL_COUNT',
  summaryPerfAudit: 'SUMMARY_PERF_AUDIT_COUNT',
}

export const DOCUMENT_UTILITY_PERF_COVERAGE_MINIMUMS: Readonly<Record<DocumentUtilityPerfCoverageKey, number>> = {
  userContentMutationSemanticReconcile: 1,
  userContentMutationCaptionScan: 1,
  pluginPresentationMutationShortCircuit: 1,
  noneMutationShortCircuit: 1,
  codeCandidateCacheHit: 1,
  captionUnchangedPlanNoop: 1,
  diagnosticActiveSwitchIncrementalVisual: 1,
  summaryPerfAudit: 1,
}

export type DocumentUtilityPerfCoverageCounters = Record<DocumentUtilityPerfCoverageKey, number>

export function createDocumentUtilityPerfCoverageCounters(): DocumentUtilityPerfCoverageCounters {
  return DOCUMENT_UTILITY_PERF_COVERAGE_KEYS.reduce((acc, k) => {
    acc[k] = 0
    return acc
  }, {} as DocumentUtilityPerfCoverageCounters)
}

export function formatDocumentUtilityPerfCoverageReport(
  counters: Readonly<DocumentUtilityPerfCoverageCounters>,
): string[] {
  return DOCUMENT_UTILITY_PERF_COVERAGE_KEYS.map(k => `${DOCUMENT_UTILITY_PERF_COVERAGE_LABELS[k]}=${counters[k] ?? 0}`)
}

export function evaluateDocumentUtilityPerfCoverage(
  counters: Readonly<DocumentUtilityPerfCoverageCounters>,
  minimums: Readonly<Record<DocumentUtilityPerfCoverageKey, number>> = DOCUMENT_UTILITY_PERF_COVERAGE_MINIMUMS,
): { decision: 'PASS' | 'FAIL'; unmet: DocumentUtilityPerfCoverageKey[] } {
  const unmet = DOCUMENT_UTILITY_PERF_COVERAGE_KEYS.filter(k => (counters[k] ?? 0) < (minimums[k] ?? 1))
  return { decision: unmet.length === 0 ? 'PASS' : 'FAIL', unmet }
}

// ── §23/§24/§25 — forensic verbosity ──────────────────────

export type ForensicVerbosity = 'OFF' | 'SUMMARY' | 'TRACE'

/** §25 — per-target Rect payloads are only legal for FAIL / the active target / TRACE. */
export function shouldEmitVerboseTargetAudit(input: {
  verbosity: ForensicVerbosity
  decision: 'PASS' | 'FAIL'
  isActiveTarget: boolean
}): boolean {
  if (input.verbosity === 'TRACE') return true
  if (input.verbosity === 'OFF') return false
  return input.decision === 'FAIL' || input.isActiveTarget
}
