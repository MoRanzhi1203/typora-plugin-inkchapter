/**
 * v2.5.7-R5.4.1: Live Formula Revision + Affected Formula Diff.
 *
 * Distinguishes diskSourceSha256 (persistence authority) from the LIVE editor
 * dirty-buffer revision. liveFormulaRevision only advances when block-formula
 * numbering semantics actually change; TYPOORA_RENDERER_INTERNAL_ONLY and
 * InkChapter decoration mutations are ignored (feedback-loop barrier).
 *
 * The semantic snapshot is built ONLY from canonical block formula hosts —
 * MJX-CONTAINER / SVG / MathJax internal nodes are rejected.
 */

import { emitRuntimeAudit } from '../runtime/forensic-log-sink'
import { simpleHash, type FormulaTexSourceKind } from './formula-tex-source-verifier'

export const R541_RUNTIME_MARKER = 'FORMULA-LIVE-REVISION-RENDER-INVALIDATION-V2.5.7-R5.4.1'
export const R541_BUILD_MARKER = 'inkchapter-formula-live-revision-render-invalidation-v2.5.7-r5.4.1'

export type MutationClassification =
  | 'TYPOORA_RENDERER_INTERNAL_ONLY'
  | 'INKCHAPTER_DECORATION_ONLY'
  | 'REAL_DOCUMENT_CONTENT'
  | 'MIXED_CONTENT_AND_RENDERER'
  | 'STARTUP'
  | 'UNKNOWN'

export type LiveFormulaRevisionReason =
  | 'ADD_BLOCK_FORMULA'
  | 'REMOVE_BLOCK_FORMULA'
  | 'MOVE_BLOCK_FORMULA'
  | 'FORMULA_SOURCE_CHANGE'
  | 'FORMULA_ORDER_CHANGE'
  | 'HEADING_CONTEXT_CHANGE_AFFECTING_FORMULA'
  | 'SECTION_OR_CHAPTER_RENUMBER_AFFECTING_FORMULA'
  | 'FORMULA_NUMBERING_SETTING_CHANGE'
  | 'NO_SEMANTIC_CHANGE'
  | 'RENDERER_INTERNAL_IGNORED'

export type PlanDiffKind =
  | 'ADDED'
  | 'REMOVED'
  | 'SOURCE_CHANGED'
  | 'ORDER_CHANGED'
  | 'DESIRED_TAG_CHANGED'
  | 'CONTEXT_CHANGED'
  | 'SCOPE_CHANGED'      // v2.5.7-R5.4.3.12
  | 'SEQUENCE_CHANGED'   // v2.5.7-R5.4.3.12
  | 'UNCHANGED'

// ── Semantic Snapshot ──────────────────────────────────────────────────

export interface LiveFormulaSemanticEntryInput {
  host: HTMLElement
  formulaIndex: number
  documentOrder: number
  desiredTag: string
  chapterOrdinal: number | null
  sectionOrdinal: number | null
  sequenceValue: number | null
  sourceKind: FormulaTexSourceKind
  /** Authoritative per-identity source hash (stable across renderer drift). */
  normalizedSourceHash: string
  normalizedSourcePrefix: string
  managedEligible: boolean
  /** v2.5.7-R5.4.2: per-identity TeX content revision (advances ONLY on user edit). */
  formulaContentRevision: number
  scopeKey?: string | null           // v2.5.7-R5.4.3.12
}

export interface LiveFormulaSemanticEntry {
  stableFormulaIdentity: number | 'AMBIGUOUS'
  formulaHostToken: number
  documentOrder: number
  formulaIndex: number
  sourceKind: FormulaTexSourceKind
  normalizedSourceHash: string
  normalizedSourcePrefix: string
  chapterOrdinal: number | null
  sectionOrdinal: number | null
  sequenceValue: number | null
  desiredTag: string
  expectedVisibleLabel: string
  managedEligible: boolean
  explicitTagControl: boolean
  formulaContentRevision: number
  scopeKey: string | null           // v2.5.7-R5.4.3.12
}

export interface LiveFormulaSemanticSnapshot {
  documentKey: string
  liveFormulaRevision: number
  formulaCount: number
  managedFormulaCount: number
  semanticSignature: string
  entries: LiveFormulaSemanticEntry[]
}

// ── Stable identity via canonical host WeakMap token ───────────────────

const hostIdentityTokens = new WeakMap<HTMLElement, number>()
let nextIdentityToken = 1

/** Canonical host object identity is the primary stable identity (A). */
export function resolveStableFormulaIdentity(host: HTMLElement): number {
  let t = hostIdentityTokens.get(host)
  if (t === undefined) {
    t = nextIdentityToken++
    hostIdentityTokens.set(host, t)
  }
  return t
}

export function resetIdentityTokens(): void {
  nextIdentityToken = 1
  // WeakMap cannot be cleared; a fresh map per session keeps tokens stable
  // for the session lifetime — acceptable for live-editor identity.
}

/** Test-only: reset the module-level live revision state. */
export function resetLiveRevisionState(): void {
  liveRevision = emptyRevision()
  previousSnapshotCountRef.current = 0
}

// ── Semantic signature ─────────────────────────────────────────────────

/**
 * Structural fingerprint ONLY — deliberately excludes stableFormulaIdentity and
 * formulaIndex: a Typora-owned rerender replaces canonical hosts (WeakMap token
 * changes) but preserves order/source/tag; the signature must NOT change then,
 * otherwise the rerender → advance → invalidate loop would never terminate.
 * documentOrder captures insertion/removal/move semantics (shifted formulas
 * change the signature → revision advance → affected set → invalidation).
 */
export function computeSemanticSignature(entries: LiveFormulaSemanticEntry[]): string {
  const canonical = entries.map((e) => [
    String(e.documentOrder),
    e.sourceKind,
    e.normalizedSourceHash,
    e.desiredTag,
    e.chapterOrdinal ?? '',
    e.sectionOrdinal ?? '',
    e.sequenceValue ?? '',
    String(e.managedEligible),
    String(e.explicitTagControl),
  ].join('|')).join('\n')
  return simpleHash(canonical)
}

// ── Snapshot builder (pure) ────────────────────────────────────────────

export function buildLiveFormulaSemanticSnapshot(input: {
  documentKey: string
  liveFormulaRevision: number
  entries: LiveFormulaSemanticEntryInput[]
}): LiveFormulaSemanticSnapshot {
  const entries: LiveFormulaSemanticEntry[] = input.entries.map((e) => ({
    stableFormulaIdentity: resolveStableFormulaIdentity(e.host),
    formulaHostToken: e.formulaIndex + 1,
    documentOrder: e.documentOrder,
    formulaIndex: e.formulaIndex,
    sourceKind: e.sourceKind,
    normalizedSourceHash: e.normalizedSourceHash,
    normalizedSourcePrefix: e.normalizedSourcePrefix,
    chapterOrdinal: e.chapterOrdinal,
    sectionOrdinal: e.sectionOrdinal,
    sequenceValue: e.sequenceValue,
    desiredTag: e.desiredTag,
    expectedVisibleLabel: `(${e.desiredTag})`,
    managedEligible: e.managedEligible,
    explicitTagControl: false,
    formulaContentRevision: e.formulaContentRevision,
    scopeKey: e.scopeKey ?? null,
  }))
  return {
    documentKey: input.documentKey,
    liveFormulaRevision: input.liveFormulaRevision,
    formulaCount: entries.length,
    managedFormulaCount: entries.filter((e) => e.managedEligible).length,
    semanticSignature: computeSemanticSignature(entries),
    entries,
  }
}

// ── Revision decision (pure) ───────────────────────────────────────────

export interface LiveRevisionDecisionInput {
  previousSemanticSignature: string
  currentSemanticSignature: string
  mutationClassification: MutationClassification
  previousFormulaCount: number
  currentFormulaCount: number
}

export interface LiveRevisionDecision {
  formulaSemanticChanged: boolean
  semanticReason: LiveFormulaRevisionReason
  decision: 'ADVANCE' | 'IGNORED_RENDERER_INTERNAL' | 'NO_SEMANTIC_CHANGE'
}

export function decideLiveFormulaRevision(input: LiveRevisionDecisionInput): LiveRevisionDecision {
  if (input.mutationClassification === 'TYPOORA_RENDERER_INTERNAL_ONLY' || input.mutationClassification === 'INKCHAPTER_DECORATION_ONLY') {
    return { formulaSemanticChanged: false, semanticReason: 'RENDERER_INTERNAL_IGNORED', decision: 'IGNORED_RENDERER_INTERNAL' }
  }
  const semanticChanged = input.previousSemanticSignature !== input.currentSemanticSignature
  if (!semanticChanged) {
    return { formulaSemanticChanged: false, semanticReason: 'NO_SEMANTIC_CHANGE', decision: 'NO_SEMANTIC_CHANGE' }
  }
  let reason: LiveFormulaRevisionReason
  if (input.currentFormulaCount > input.previousFormulaCount) reason = 'ADD_BLOCK_FORMULA'
  else if (input.currentFormulaCount < input.previousFormulaCount) reason = 'REMOVE_BLOCK_FORMULA'
  else reason = 'FORMULA_ORDER_CHANGE'
  return { formulaSemanticChanged: true, semanticReason: reason, decision: 'ADVANCE' }
}

// ── Live Revision State ────────────────────────────────────────────────

export interface LiveFormulaDocumentRevision {
  documentKey: string
  documentGeneration: number
  diskSourceSha256: string
  liveDocumentRevision: number
  liveFormulaRevision: number
  previousSemanticSignature: string
  currentSemanticSignature: string
  revisionReason: LiveFormulaRevisionReason
}

const emptyRevision = (): LiveFormulaDocumentRevision => ({
  documentKey: '',
  documentGeneration: 0,
  diskSourceSha256: '',
  liveDocumentRevision: 0,
  liveFormulaRevision: 0,
  previousSemanticSignature: '',
  currentSemanticSignature: '',
  revisionReason: 'NO_SEMANTIC_CHANGE',
})

let liveRevision: LiveFormulaDocumentRevision = emptyRevision()

export function getLiveFormulaRevision(): LiveFormulaDocumentRevision {
  return { ...liveRevision }
}

/** Rebind to a new document (document switch). */
export function rebindLiveRevision(input: { documentKey: string; documentGeneration: number; diskSourceSha256: string }): void {
  liveRevision = { ...emptyRevision(), documentKey: input.documentKey, documentGeneration: input.documentGeneration, diskSourceSha256: input.diskSourceSha256 }
}

/**
 * Advance the live revision from a semantic snapshot. Called on real-content
 * mutations AFTER the semantic snapshot is rebuilt. Renderer-internal
 * mutations never reach here (ignored by mutation ownership).
 */
export function advanceLiveRevision(input: {
  documentKey: string
  documentGeneration: number
  diskSourceSha256: string
  mutationClassification: MutationClassification
  snapshot: LiveFormulaSemanticSnapshot
  previousSnapshotCount: number
  /** Optional precise reason derived from the plan diff (overrides heuristic). */
  semanticReasonHint?: LiveFormulaRevisionReason | null
}): { advanced: boolean; decision: string; reason: LiveFormulaRevisionReason | null } {
  const prev = liveRevision
  const sameDocument = prev.documentKey === input.documentKey || prev.documentKey === ''
  const decision = decideLiveFormulaRevision({
    previousSemanticSignature: prev.currentSemanticSignature,
    currentSemanticSignature: input.snapshot.semanticSignature,
    mutationClassification: input.mutationClassification,
    previousFormulaCount: input.previousSnapshotCount,
    currentFormulaCount: input.snapshot.formulaCount,
  })

  const advanced = sameDocument && decision.decision === 'ADVANCE'
  const finalReason = advanced && input.semanticReasonHint ? input.semanticReasonHint : decision.semanticReason
  // liveDocumentRevision counts REAL business-content changes only; renderer
  // internal / decoration mutations are ignored entirely (loop barrier).
  const ignored = decision.decision === 'IGNORED_RENDERER_INTERNAL'
  const documentAdvanced = sameDocument && !ignored
  if (advanced) {
    liveRevision = {
      ...liveRevision,
      documentKey: input.documentKey,
      documentGeneration: input.documentGeneration,
      diskSourceSha256: input.diskSourceSha256,
      liveDocumentRevision: liveRevision.liveDocumentRevision + 1,
      liveFormulaRevision: liveRevision.liveFormulaRevision + 1,
      previousSemanticSignature: prev.currentSemanticSignature,
      currentSemanticSignature: input.snapshot.semanticSignature,
      revisionReason: finalReason,
    }
  } else {
    liveRevision = {
      ...liveRevision,
      documentKey: input.documentKey,
      documentGeneration: input.documentGeneration,
      diskSourceSha256: input.diskSourceSha256,
      liveDocumentRevision: documentAdvanced ? liveRevision.liveDocumentRevision + 1 : liveRevision.liveDocumentRevision,
      previousSemanticSignature: prev.currentSemanticSignature,
      currentSemanticSignature: input.snapshot.semanticSignature,
      revisionReason: finalReason,
    }
  }

  emitRuntimeAudit('FORMULA-LIVE-REVISION-AUTHORITY', {
    documentKey: input.documentKey,
    documentGeneration: input.documentGeneration,
    diskSourceSha256: input.diskSourceSha256,
    previousLiveDocumentRevision: prev.liveDocumentRevision,
    nextLiveDocumentRevision: liveRevision.liveDocumentRevision,
    previousLiveFormulaRevision: prev.liveFormulaRevision,
    nextLiveFormulaRevision: liveRevision.liveFormulaRevision,
    mutationClassification: input.mutationClassification,
    semanticReason: finalReason,
    formulaSemanticChanged: decision.formulaSemanticChanged,
    decision: advanced ? 'ADVANCE' : decision.decision,
    runtimeMarker: R541_RUNTIME_MARKER,
  })

  return { advanced, decision: decision.decision, reason: decision.formulaSemanticChanged ? finalReason : null }
}

/**
 * Record the FIRST semantic baseline for a document (document open / switch).
 * The baseline snapshot does NOT advance the revision — it is the reference
 * against which subsequent dirty-buffer changes are diffed.
 */
export function recordSemanticBaseline(input: {
  documentKey: string
  documentGeneration: number
  diskSourceSha256: string
  snapshot: LiveFormulaSemanticSnapshot
}): void {
  const prev = liveRevision
  liveRevision = {
    ...liveRevision,
    documentKey: input.documentKey,
    documentGeneration: input.documentGeneration,
    diskSourceSha256: input.diskSourceSha256,
    previousSemanticSignature: input.snapshot.semanticSignature,
    currentSemanticSignature: input.snapshot.semanticSignature,
    revisionReason: 'NO_SEMANTIC_CHANGE',
  }
  emitRuntimeAudit('FORMULA-LIVE-REVISION-AUTHORITY', {
    documentKey: input.documentKey,
    documentGeneration: input.documentGeneration,
    diskSourceSha256: input.diskSourceSha256,
    previousLiveDocumentRevision: prev.liveDocumentRevision,
    nextLiveDocumentRevision: liveRevision.liveDocumentRevision,
    previousLiveFormulaRevision: prev.liveFormulaRevision,
    nextLiveFormulaRevision: liveRevision.liveFormulaRevision,
    mutationClassification: 'STARTUP',
    semanticReason: 'NO_SEMANTIC_CHANGE',
    formulaSemanticChanged: false,
    decision: 'INITIAL_BASELINE',
    runtimeMarker: R541_RUNTIME_MARKER,
  })
}

/** @internal — previous snapshot count tracking for add/remove classification. */
export const previousSnapshotCountRef = { current: 0 }

// ── Dirty Buffer Authority ─────────────────────────────────────────────

export interface DirtyBufferAuthorityInput {
  documentKey: string
  diskSourceSha256: string
  liveFormulaRevision: number
  diskFormulaCount: number
  liveFormulaCount: number
}

export function emitDirtyBufferAuthority(input: DirtyBufferAuthorityInput): void {
  const diverged = input.liveFormulaCount !== input.diskFormulaCount
  emitRuntimeAudit('FORMULA-DIRTY-BUFFER-AUTHORITY', {
    documentKey: input.documentKey,
    diskSourceSha256: input.diskSourceSha256,
    liveDocumentRevision: liveRevision.liveDocumentRevision,
    liveFormulaRevision: input.liveFormulaRevision,
    editorDirty: diverged,
    diskFormulaCount: input.diskFormulaCount,
    liveFormulaCount: input.liveFormulaCount,
    divergedFromDisk: diverged,
    decision: 'PASS',
    runtimeMarker: R541_RUNTIME_MARKER,
  })
}

// ── Semantic Snapshot Markers ──────────────────────────────────────────

export function emitSemanticSnapshotMarkers(snapshot: LiveFormulaSemanticSnapshot): void {
  emitRuntimeAudit('FORMULA-LIVE-SEMANTIC-SNAPSHOT', {
    documentKey: snapshot.documentKey,
    liveFormulaRevision: snapshot.liveFormulaRevision,
    formulaCount: snapshot.formulaCount,
    managedFormulaCount: snapshot.managedFormulaCount,
    semanticSignature: snapshot.semanticSignature,
    decision: 'RECORDED',
    runtimeMarker: R541_RUNTIME_MARKER,
  })
  for (const e of snapshot.entries) {
    emitRuntimeAudit('FORMULA-LIVE-SEMANTIC-ENTRY', {
      stableFormulaIdentity: e.stableFormulaIdentity,
      formulaHostToken: e.formulaHostToken,
      documentOrder: e.documentOrder,
      formulaIndex: e.formulaIndex,
      sourceKind: e.sourceKind,
      normalizedSourceHash: e.normalizedSourceHash,
      chapterOrdinal: e.chapterOrdinal,
      sectionOrdinal: e.sectionOrdinal,
      sequenceValue: e.sequenceValue,
      desiredTag: e.desiredTag,
      expectedVisibleLabel: e.expectedVisibleLabel,
      managedEligible: e.managedEligible,
      explicitTagControl: e.explicitTagControl,
      decision: 'RECORDED',
      runtimeMarker: R541_RUNTIME_MARKER,
    })
  }
}

// ── Plan Diff + Affected Set ───────────────────────────────────────────

export interface LivePlanDiffEntry {
  stableFormulaIdentity: number | 'AMBIGUOUS' | null
  previousFormulaIndex: number | null
  nextFormulaIndex: number | null
  previousSourceHash: string | null
  nextSourceHash: string | null
  previousDesiredTag: string | null
  nextDesiredTag: string | null
  previousContentRevision: number | null
  nextContentRevision: number | null
  previousScopeKey: string | null          // v2.5.7-R5.4.3.12
  nextScopeKey: string | null              // v2.5.7-R5.4.3.12
  previousSequenceValue: number | null     // v2.5.7-R5.4.3.12
  nextSequenceValue: number | null         // v2.5.7-R5.4.3.12
  changeKinds: PlanDiffKind[]
  requiresRenderInvalidation: boolean
}

export function diffLiveFormulaPlans(
  previous: LiveFormulaSemanticSnapshot | null,
  current: LiveFormulaSemanticSnapshot,
): LivePlanDiffEntry[] {
  const prevByIdentity = new Map<number, LiveFormulaSemanticEntry>()
  const prevAmbiguous: LiveFormulaSemanticEntry[] = []
  const currByIdentity = new Map<number, LiveFormulaSemanticEntry>()
  const currAmbiguous: LiveFormulaSemanticEntry[] = []

  for (const e of previous?.entries ?? []) {
    if (e.stableFormulaIdentity === 'AMBIGUOUS') prevAmbiguous.push(e)
    else prevByIdentity.set(e.stableFormulaIdentity, e)
  }
  for (const e of current.entries) {
    if (e.stableFormulaIdentity === 'AMBIGUOUS') currAmbiguous.push(e)
    else currByIdentity.set(e.stableFormulaIdentity, e)
  }

  const diffs: LivePlanDiffEntry[] = []
  const allIdentities = new Set<number>([...prevByIdentity.keys(), ...currByIdentity.keys()])
  for (const id of allIdentities) {
    const p = prevByIdentity.get(id)
    const c = currByIdentity.get(id)
    const kinds: PlanDiffKind[] = []
    if (!p && c) kinds.push('ADDED')
    else if (p && !c) kinds.push('REMOVED')
    else if (p && c) {
      // v2.5.7-R5.4.2 Phase K: SOURCE_CHANGED fires ONLY when the per-identity
      // formulaContentRevision advanced (real user TeX edit). Renderer/edit-state
      // hash drift must never produce a document-wide SOURCE_CHANGED.
      if (p.formulaContentRevision !== c.formulaContentRevision) kinds.push('SOURCE_CHANGED')
      if (p.formulaIndex !== c.formulaIndex) kinds.push('ORDER_CHANGED')
      if (p.desiredTag !== c.desiredTag) kinds.push('DESIRED_TAG_CHANGED')
      if (p.chapterOrdinal !== c.chapterOrdinal || p.sectionOrdinal !== c.sectionOrdinal) kinds.push('CONTEXT_CHANGED')
      if (p.scopeKey !== c.scopeKey) kinds.push('SCOPE_CHANGED')
      if (p.sequenceValue !== c.sequenceValue) kinds.push('SEQUENCE_CHANGED')
      if (kinds.length === 0) kinds.push('UNCHANGED')
    }
    const requiresRenderInvalidation = kinds.some((k) => k === 'SOURCE_CHANGED' || k === 'DESIRED_TAG_CHANGED' || k === 'ORDER_CHANGED' || k === 'CONTEXT_CHANGED' || k === 'SCOPE_CHANGED' || k === 'SEQUENCE_CHANGED')
    diffs.push({
      stableFormulaIdentity: id,
      previousFormulaIndex: p?.formulaIndex ?? null,
      nextFormulaIndex: c?.formulaIndex ?? null,
      previousSourceHash: p?.normalizedSourceHash ?? null,
      nextSourceHash: c?.normalizedSourceHash ?? null,
      previousDesiredTag: p?.desiredTag ?? null,
      nextDesiredTag: c?.desiredTag ?? null,
      previousContentRevision: p?.formulaContentRevision ?? null,
      nextContentRevision: c?.formulaContentRevision ?? null,
      previousScopeKey: p?.scopeKey ?? null,
      nextScopeKey: c?.scopeKey ?? null,
      previousSequenceValue: p?.sequenceValue ?? null,
      nextSequenceValue: c?.sequenceValue ?? null,
      changeKinds: kinds,
      requiresRenderInvalidation,
    })
  }
  // Ambiguous-identity entries cannot be diffed — mark without guessing.
  for (const e of prevAmbiguous) {
    diffs.push({ stableFormulaIdentity: 'AMBIGUOUS', previousFormulaIndex: e.formulaIndex, nextFormulaIndex: null, previousSourceHash: e.normalizedSourceHash, nextSourceHash: null, previousDesiredTag: e.desiredTag, nextDesiredTag: null, previousContentRevision: e.formulaContentRevision, nextContentRevision: null, previousScopeKey: null, nextScopeKey: null, previousSequenceValue: null, nextSequenceValue: null, changeKinds: ['REMOVED'], requiresRenderInvalidation: false })
  }
  for (const e of currAmbiguous) {
    diffs.push({ stableFormulaIdentity: 'AMBIGUOUS', previousFormulaIndex: null, nextFormulaIndex: e.formulaIndex, previousSourceHash: null, nextSourceHash: e.normalizedSourceHash, previousDesiredTag: null, nextDesiredTag: e.desiredTag, previousContentRevision: null, nextContentRevision: e.formulaContentRevision, previousScopeKey: null, nextScopeKey: null, previousSequenceValue: null, nextSequenceValue: null, changeKinds: ['ADDED'], requiresRenderInvalidation: false })
  }
  return diffs
}

export interface AffectedFormulaSet {
  liveFormulaRevision: number
  addedCount: number
  removedCount: number
  sourceChangedCount: number
  desiredTagChangedCount: number
  contextChangedCount: number
  affectedNewFormulaCount: number
  affectedExistingFormulaCount: number
  affectedStableFormulaIdentities: Array<number | 'AMBIGUOUS' | null>
}

export function computeAffectedFormulaSet(diffs: LivePlanDiffEntry[]): AffectedFormulaSet {
  const affected = new Set<number | 'AMBIGUOUS' | null>()
  let addedCount = 0
  let removedCount = 0
  let sourceChangedCount = 0
  let desiredTagChangedCount = 0
  let contextChangedCount = 0
  let affectedExisting = 0
  let affectedNew = 0

  for (const d of diffs) {
    const kinds = d.changeKinds
    if (kinds.includes('ADDED')) {
      addedCount++
      affectedNew++
      affected.add(d.stableFormulaIdentity)
      continue
    }
    if (kinds.includes('REMOVED')) {
      // Removed formulas do not rerender themselves; survivors are handled by
      // their own diff entries.
      removedCount++
      continue
    }
    // Existing surviving formula — count ONCE even with multiple change kinds.
    let isAffected = false
    if (kinds.includes('SOURCE_CHANGED')) { sourceChangedCount++; isAffected = true }
    if (kinds.includes('DESIRED_TAG_CHANGED')) { desiredTagChangedCount++; isAffected = true }
    if (kinds.includes('CONTEXT_CHANGED')) { contextChangedCount++; isAffected = true }
    if (kinds.includes('ORDER_CHANGED')) isAffected = true
    if (isAffected) {
      affectedExisting++
      affected.add(d.stableFormulaIdentity)
    }
  }
  return {
    liveFormulaRevision: 0, // set by caller
    addedCount,
    removedCount,
    sourceChangedCount,
    desiredTagChangedCount,
    contextChangedCount,
    affectedNewFormulaCount: affectedNew,
    affectedExistingFormulaCount: affectedExisting,
    affectedStableFormulaIdentities: Array.from(affected),
  }
}

export function emitPlanDiffMarkers(diffs: LivePlanDiffEntry[]): void {
  for (const d of diffs) {
    emitRuntimeAudit('FORMULA-LIVE-PLAN-DIFF', {
      stableFormulaIdentity: d.stableFormulaIdentity,
      previousFormulaIndex: d.previousFormulaIndex,
      nextFormulaIndex: d.nextFormulaIndex,
      previousSourceHash: d.previousSourceHash,
      nextSourceHash: d.nextSourceHash,
      previousDesiredTag: d.previousDesiredTag,
      nextDesiredTag: d.nextDesiredTag,
      previousContentRevision: d.previousContentRevision,
      nextContentRevision: d.nextContentRevision,
      changeKinds: d.changeKinds.join(','),
      requiresRenderInvalidation: d.requiresRenderInvalidation,
      decision: d.requiresRenderInvalidation ? 'AFFECTED' : 'NOT_AFFECTED',
      runtimeMarker: R541_RUNTIME_MARKER,
    })
  }
}

/**
 * v2.5.7-R5.4.2 Phase K: revision noise authority. Renderer / edit-state
 * mutations must never create a document-wide SOURCE_CHANGED.
 */
export function emitLiveRevisionNoiseAuthority(input: {
  mutationBatchId: string
  formulaStructureChanged: boolean
  contentChangedFormulaCount: number
  rendererOnlyFormulaCount: number
  documentWideSourceChangedCount: number
  spuriousSourceChangedCount: number
}): void {
  emitRuntimeAudit('FORMULA-LIVE-REVISION-NOISE-AUTHORITY', {
    mutationBatchId: input.mutationBatchId,
    formulaStructureChanged: input.formulaStructureChanged,
    contentChangedFormulaCount: input.contentChangedFormulaCount,
    rendererOnlyFormulaCount: input.rendererOnlyFormulaCount,
    documentWideSourceChangedCount: input.documentWideSourceChangedCount,
    spuriousSourceChangedCount: input.spuriousSourceChangedCount,
    decision: input.spuriousSourceChangedCount === 0 ? 'PASS' : 'FAIL',
    reason: input.spuriousSourceChangedCount === 0 ? null : 'SPURIOUS_SOURCE_CHANGED_DETECTED',
    runtimeMarker: R541_RUNTIME_MARKER,
  })
}

export function emitAffectedRenderSet(set: AffectedFormulaSet, liveFormulaRevision: number): void {
  emitRuntimeAudit('FORMULA-AFFECTED-RENDER-SET', {
    liveFormulaRevision,
    addedCount: set.addedCount,
    removedCount: set.removedCount,
    sourceChangedCount: set.sourceChangedCount,
    desiredTagChangedCount: set.desiredTagChangedCount,
    contextChangedCount: set.contextChangedCount,
    affectedNewFormulaCount: set.affectedNewFormulaCount,
    affectedExistingFormulaCount: set.affectedExistingFormulaCount,
    affectedStableFormulaIdentities: set.affectedStableFormulaIdentities.join(','),
    decision: set.affectedExistingFormulaCount + set.affectedNewFormulaCount > 0 ? 'AFFECTED' : 'CLEAN',
    reason: null,
    runtimeMarker: R541_RUNTIME_MARKER,
  })
}

// ── Live Update Final Verify (Phase O) ────────────────────────────────

export interface LiveUpdateVerifyInput {
  liveFormulaRevision: number
  formulaCount: number
  affectedFormulaCount: number
  authorizedNewFormulaCount: number
  invalidatedExistingFormulaCount: number
  pendingFormulaCount: number
  allDesiredTagsVisible: boolean
  duplicateOutputCount: number
  sourceMutationDetected: boolean
}

export function emitLiveUpdateVerify(input: LiveUpdateVerifyInput): void {
  const decision = input.pendingFormulaCount === 0
    && input.allDesiredTagsVisible
    && input.duplicateOutputCount === 0
    && !input.sourceMutationDetected
    ? 'PASS'
    : 'FAIL'
  emitRuntimeAudit('FORMULA-LIVE-UPDATE-VERIFY', {
    liveFormulaRevision: input.liveFormulaRevision,
    formulaCount: input.formulaCount,
    affectedFormulaCount: input.affectedFormulaCount,
    authorizedNewFormulaCount: input.authorizedNewFormulaCount,
    invalidatedExistingFormulaCount: input.invalidatedExistingFormulaCount,
    pendingFormulaCount: input.pendingFormulaCount,
    allDesiredTagsVisible: input.allDesiredTagsVisible,
    duplicateOutputCount: input.duplicateOutputCount,
    sourceMutationDetected: input.sourceMutationDetected,
    decision,
    reason: decision === 'PASS' ? null
      : input.pendingFormulaCount !== 0 ? 'PENDING_FORMULA'
        : !input.allDesiredTagsVisible ? 'TAG_NOT_VISIBLE'
          : input.duplicateOutputCount !== 0 ? 'DUPLICATE_OUTPUT'
            : 'SOURCE_MUTATION_DETECTED',
    runtimeMarker: R541_RUNTIME_MARKER,
  })
}

// ── Live Update Final (Phase W) ───────────────────────────────────────

export interface LiveUpdateFinalInput {
  documentKey: string
  diskSourceSha256: string
  liveDocumentRevision: number
  liveFormulaRevision: number
  liveFormulaCount: number
  managedFormulaCount: number
  planRevision: number | null
  planLiveFormulaRevision: number | null
  newFormulaCatchupPass: boolean
  affectedFormulaDiffPass: boolean
  typoraRenderInvalidationAuthority: string
  affectedRenderClosurePass: boolean
  allDesiredTagsVisible: boolean
  pendingFormulaCount: number
  duplicateOutputCount: number
  rendererFeedbackLoopCount: number
  sourceMutationDetected: boolean
}

export function emitLiveUpdateFinal(input: LiveUpdateFinalInput): void {
  const decision = input.liveFormulaCount >= 0
    && input.newFormulaCatchupPass
    && input.affectedFormulaDiffPass
    && input.typoraRenderInvalidationAuthority === 'PASS'
    && input.affectedRenderClosurePass
    && input.allDesiredTagsVisible
    && input.pendingFormulaCount === 0
    && input.duplicateOutputCount === 0
    && input.rendererFeedbackLoopCount === 0
    && !input.sourceMutationDetected
    ? 'PASS'
    : 'PARTIAL'
  emitRuntimeAudit('FORMULA-LIVE-UPDATE-FINAL', {
    documentKey: input.documentKey,
    diskSourceSha256: input.diskSourceSha256,
    liveDocumentRevision: input.liveDocumentRevision,
    liveFormulaRevision: input.liveFormulaRevision,
    liveFormulaCount: input.liveFormulaCount,
    managedFormulaCount: input.managedFormulaCount,
    planRevision: input.planRevision,
    planLiveFormulaRevision: input.planLiveFormulaRevision,
    newFormulaCatchupPass: input.newFormulaCatchupPass,
    affectedFormulaDiffPass: input.affectedFormulaDiffPass,
    typoraRenderInvalidationAuthority: input.typoraRenderInvalidationAuthority,
    affectedRenderClosurePass: input.affectedRenderClosurePass,
    allDesiredTagsVisible: input.allDesiredTagsVisible,
    pendingFormulaCount: input.pendingFormulaCount,
    duplicateOutputCount: input.duplicateOutputCount,
    rendererFeedbackLoopCount: input.rendererFeedbackLoopCount,
    sourceMutationDetected: input.sourceMutationDetected,
    decision,
    reason: decision === 'PASS' ? null : 'LIVE_UPDATE_CLOSURE_INCOMPLETE',
    runtimeMarker: R541_RUNTIME_MARKER,
  })
}
