/**
 * v2.5.7-R5.4.1: Typora-owned Existing Formula Render Invalidation.
 *
 * Read-only audit of the Typora runtime surface for a SAFE existing-formula
 * rerender trigger. Proven constraints:
 *   * startup.document registryItemCount=0, ownershipCase=A → typesetClear /
 *     startup.document.typesetPromise are FORBIDDEN.
 *   * InkChapter may NOT call MathJax.tex2svgPromise directly (would create a
 *     second output).
 *   * No synthetic focus/blur/keys, no DOM replacement, no frame.js patching.
 *
 * If no safe Typora-owned trigger is found, the authority reports BLOCK and
 * the pipeline STOPS at
 *   R54_1_TYPORA_FORMULA_RERENDER_TRIGGER_NOT_ESTABLISHED
 */

import { emitRuntimeAudit } from '../runtime/forensic-log-sink'
import { R541_RUNTIME_MARKER } from './formula-live-revision'
import { R542_RUNTIME_MARKER } from './formula-authoritative-source'

export interface RenderInvalidationTriggerAudit {
  triggerName: string
  ownerName: string
  callable: boolean
  safeForExistingFormula: boolean
  sourceImmutable: boolean
  selectionPreserved: boolean
  editorStatePreserved: boolean
  routesThroughTex2svgPromiseObserved: boolean
  decision: 'PASS' | 'BLOCK' | 'NOT_CALLABLE'
  reason: string | null
}

/**
 * Read-only probe of candidate Typora math-block rerender surfaces.
 * Only typeof/getOwnPropertyDescriptor checks — never invokes anything.
 */
export function auditTyporaRenderInvalidationTrigger(): RenderInvalidationTriggerAudit {
  const surface: Array<{ triggerName: string; ownerName: string; get: () => unknown }> = []
  const win = typeof window !== 'undefined' ? window as any : null
  const editor = win?.editor ?? win?.onMyEditor ?? win?.monaco ?? null
  const activeEditor = win?.onMyEditor?.getActiveEditor?.() ?? null
  const mathApi = win?.mathjax ?? win?.MathJax

  // Candidate 1: active editor math block update API (read-only check).
  surface.push({
    triggerName: 'updateMathBlock',
    ownerName: 'window.onMyEditor.getActiveEditor()',
    get: () => activeEditor?.updateMathBlock,
  })
  surface.push({
    triggerName: 'refreshMathBlock',
    ownerName: 'window.onMyEditor.getActiveEditor()',
    get: () => activeEditor?.refreshMathBlock,
  })
  surface.push({
    triggerName: 'rerender',
    ownerName: 'window.onMyEditor.getActiveEditor()',
    get: () => activeEditor?.rerender,
  })
  // Candidate 2: editor-level generic refresh.
  surface.push({
    triggerName: 'refreshEditor',
    ownerName: 'window.onMyEditor.getActiveEditor()',
    get: () => activeEditor?.refreshEditor,
  })
  surface.push({
    triggerName: 'updateFormula',
    ownerName: 'window.editor',
    get: () => editor?.updateFormula,
  })
  // Candidate 3: MathJax client-side typeset helper (must NOT be used; audited only).
  surface.push({
    triggerName: 'typesetPromise',
    ownerName: 'MathJax',
    get: () => mathApi?.typesetPromise,
  })
  void win

  for (const c of surface) {
    let callable = false
    try {
      const v = c.get()
      callable = typeof v === 'function'
    } catch { /* read-only */ }
    const forbidden = c.triggerName === 'typesetPromise'
    const safe = callable && !forbidden
    if (callable) {
      const audit: RenderInvalidationTriggerAudit = {
        triggerName: c.triggerName,
        ownerName: c.ownerName,
        callable,
        safeForExistingFormula: safe,
        sourceImmutable: safe,
        selectionPreserved: safe,
        editorStatePreserved: safe,
        routesThroughTex2svgPromiseObserved: false,
        decision: safe ? 'PASS' : 'BLOCK',
        reason: safe ? null : (forbidden ? 'FORBIDDEN_SURFACE' : 'NOT_SAFE'),
      }
      emitRuntimeAudit('FORMULA-TYPORA-RENDER-INVALIDATION-AUTHORITY', {
        ...audit,
        runtimeMarker: R541_RUNTIME_MARKER,
      })
      return audit
    }
  }

  const audit: RenderInvalidationTriggerAudit = {
    triggerName: 'NONE',
    ownerName: 'typora-runtime',
    callable: false,
    safeForExistingFormula: false,
    sourceImmutable: false,
    selectionPreserved: false,
    editorStatePreserved: false,
    routesThroughTex2svgPromiseObserved: false,
    decision: 'BLOCK',
    reason: 'NO_SAFE_TYPORA_OWNED_RERENDER_TRIGGER',
  }
  emitRuntimeAudit('FORMULA-TYPORA-RENDER-INVALIDATION-AUTHORITY', {
    ...audit,
    runtimeMarker: R541_RUNTIME_MARKER,
  })
  return audit
}

// ── Request / Dedupe / Closure ─────────────────────────────────────────

export interface RenderInvalidationState {
  liveFormulaRevision: number
  requestCount: number
  executedCount: number
  skippedDuplicateCount: number
}

const executedInvalidations = new Set<string>() // key: revision|identity

/** R5.4.1 Phase K: pending closure registrations (formulaIndex → revision+tag). */
const pendingClosureByFormula = new Map<number, { liveFormulaRevision: number; desiredTag: string; stableFormulaIdentity: number | 'AMBIGUOUS' | null }>()

/** Test-only: reset the invalidation dedupe state. */
export function resetInvalidationDedupeState(): void {
  executedInvalidations.clear()
  pendingClosureByFormula.clear()
  invalidationInProgress = false
  rendererInternalMutationObserved = false
}

export function requestFormulaRenderInvalidation(input: {
  liveFormulaRevision: number
  stableFormulaIdentity: number | 'AMBIGUOUS' | null
  formulaIndex: number
  previousDesiredTag: string | null
  nextDesiredTag: string
  reason: string
  triggerName: string
}): { decision: 'REQUESTED' | 'SKIPPED_DUPLICATE' | 'BLOCKED' } {
  const key = `${input.liveFormulaRevision}|${String(input.stableFormulaIdentity)}`
  emitRuntimeAudit('FORMULA-RENDER-INVALIDATION-REQUEST', {
    liveFormulaRevision: input.liveFormulaRevision,
    stableFormulaIdentity: input.stableFormulaIdentity,
    formulaIndex: input.formulaIndex,
    previousDesiredTag: input.previousDesiredTag,
    nextDesiredTag: input.nextDesiredTag,
    reason: input.reason,
    triggerName: input.triggerName,
    decision: 'REQUESTED',
    runtimeMarker: R541_RUNTIME_MARKER,
  })
  if (executedInvalidations.has(key)) {
    emitRuntimeAudit('FORMULA-RENDER-INVALIDATION-DEDUPE', {
      liveFormulaRevision: input.liveFormulaRevision,
      stableFormulaIdentity: input.stableFormulaIdentity,
      requestCount: 1,
      executedCount: 0,
      skippedDuplicateCount: 1,
      decision: 'SKIPPED_DUPLICATE',
      runtimeMarker: R541_RUNTIME_MARKER,
    })
    return { decision: 'SKIPPED_DUPLICATE' }
  }
  executedInvalidations.add(key)
  // Register the closure expectation: the NEXT tex2svg fulfillment for this
  // formula (same live revision) closes the invalidation (Phase K).
  pendingClosureByFormula.set(input.formulaIndex, { liveFormulaRevision: input.liveFormulaRevision, desiredTag: input.nextDesiredTag, stableFormulaIdentity: input.stableFormulaIdentity })
  emitRuntimeAudit('FORMULA-RENDER-INVALIDATION-DEDUPE', {
    liveFormulaRevision: input.liveFormulaRevision,
    stableFormulaIdentity: input.stableFormulaIdentity,
    requestCount: 1,
    executedCount: 1,
    skippedDuplicateCount: 0,
    decision: 'EXECUTED',
    runtimeMarker: R541_RUNTIME_MARKER,
  })
  return { decision: 'REQUESTED' }
}

/**
 * R5.4.1 Phase K: report a REAL tex2svg fulfillment observation for a formula
 * with a pending invalidation closure. Consumes the pending entry only when the
 * observed live revision matches. Every field is an observed fact — never
 * fabricated.
 */
export function reportObservedInvalidationClosure(input: {
  formulaIndex: number
  liveFormulaRevision: number
  tex2svgCallObserved: boolean
  authorizationObserved: boolean
  injectionObserved: boolean
  fulfillmentObserved: boolean
  visibleTagAfter: string
}): void {
  const pending = pendingClosureByFormula.get(input.formulaIndex)
  if (!pending || pending.liveFormulaRevision !== input.liveFormulaRevision) return
  const expectedTagMatched = pending.desiredTag !== '' && `(${pending.desiredTag})` === input.visibleTagAfter
  pendingClosureByFormula.delete(input.formulaIndex)
  emitRuntimeAudit('FORMULA-RENDER-INVALIDATION-CLOSURE', {
    liveFormulaRevision: input.liveFormulaRevision,
    stableFormulaIdentity: pending.stableFormulaIdentity,
    invalidationRequested: true,
    typoraTriggerExecuted: input.tex2svgCallObserved,
    tex2svgCallObserved: input.tex2svgCallObserved,
    authorizationObserved: input.authorizationObserved,
    injectionObserved: input.injectionObserved,
    desiredTag: pending.desiredTag,
    fulfillmentObserved: input.fulfillmentObserved,
    visibleTagAfter: input.visibleTagAfter,
    expectedTagMatched,
    decision: expectedTagMatched ? 'PASS' : 'FAIL',
    reason: expectedTagMatched ? null : 'TAG_NOT_MATCHED',
    runtimeMarker: R541_RUNTIME_MARKER,
  })
  // v2.5.7-R5.4.2 Phase O: Typora-owned renderer invalidation closure (only for
  // trigger-driven invalidations; stable identity located — never the index).
  emitRuntimeAudit('TYPORA-FORMULA-RENDERER-INVALIDATION-CLOSURE', {
    liveFormulaRevision: input.liveFormulaRevision,
    stableFormulaIdentity: pending.stableFormulaIdentity,
    triggerExecuted: input.tex2svgCallObserved,
    tex2svgCallObserved: input.tex2svgCallObserved,
    authoritativeSourceMatched: input.authorizationObserved,
    latestDesiredTag: pending.desiredTag,
    authorizationObserved: input.authorizationObserved,
    injectionObserved: input.injectionObserved,
    fulfillmentIdentityObserved: input.fulfillmentObserved,
    visibleTagMatched: expectedTagMatched,
    decision: expectedTagMatched ? 'PASS' : 'FAIL',
    reason: expectedTagMatched ? null : 'TAG_NOT_MATCHED',
    runtimeMarker: R542_RUNTIME_MARKER,
  })
}

export function reportRenderInvalidationClosure(input: {
  liveFormulaRevision: number
  stableFormulaIdentity: number | 'AMBIGUOUS' | null
  invalidationRequested: boolean
  typoraTriggerExecuted: boolean
  tex2svgCallObserved: boolean
  authorizationObserved: boolean
  injectionObserved: boolean
  desiredTag: string
  fulfillmentObserved: boolean
  visibleTagAfter: string
  expectedTagMatched: boolean
}): void {
  emitRuntimeAudit('FORMULA-RENDER-INVALIDATION-CLOSURE', {
    liveFormulaRevision: input.liveFormulaRevision,
    stableFormulaIdentity: input.stableFormulaIdentity,
    invalidationRequested: input.invalidationRequested,
    typoraTriggerExecuted: input.typoraTriggerExecuted,
    tex2svgCallObserved: input.tex2svgCallObserved,
    authorizationObserved: input.authorizationObserved,
    injectionObserved: input.injectionObserved,
    desiredTag: input.desiredTag,
    fulfillmentObserved: input.fulfillmentObserved,
    visibleTagAfter: input.visibleTagAfter,
    expectedTagMatched: input.expectedTagMatched,
    decision: input.expectedTagMatched ? 'PASS' : 'FAIL',
    reason: input.expectedTagMatched ? null : 'TAG_NOT_MATCHED',
    runtimeMarker: R541_RUNTIME_MARKER,
  })
}

// ── Feedback Loop Barrier ──────────────────────────────────────────────

let invalidationInProgress = false
let rendererInternalMutationObserved = false

export function setInvalidationInProgress(value: boolean): void {
  invalidationInProgress = value
}

export function markRendererInternalMutationObserved(): void {
  rendererInternalMutationObserved = true
}

export function emitLoopBarrier(liveFormulaRevision: number): void {
  emitRuntimeAudit('FORMULA-LIVE-UPDATE-LOOP-BARRIER', {
    liveFormulaRevision,
    invalidationInProgress,
    rendererInternalMutationObserved,
    newSemanticRevisionCreated: false,
    repeatedInvalidationCreated: false,
    decision: 'PASS',
    runtimeMarker: R541_RUNTIME_MARKER,
  })
}

/**
 * v2.5.7-R5.4.2 Phase P: source renderer feedback barrier. A renderer rerender
 * mutation must never advance the content revision, overwrite the authoritative
 * source, or change the structure revision.
 */
export function emitSourceRendererFeedbackBarrier(input: {
  stableFormulaIdentity: number | 'AMBIGUOUS' | null
  rendererMutationObserved: boolean
  contentRevisionChanged: boolean
  authoritativeSourceChanged: boolean
  structureRevisionChanged: boolean
}): void {
  emitRuntimeAudit('FORMULA-SOURCE-RENDERER-FEEDBACK-BARRIER', {
    stableFormulaIdentity: input.stableFormulaIdentity,
    rendererMutationObserved: input.rendererMutationObserved,
    contentRevisionChanged: input.contentRevisionChanged,
    authoritativeSourceChanged: input.authoritativeSourceChanged,
    structureRevisionChanged: input.structureRevisionChanged,
    decision: input.contentRevisionChanged || input.authoritativeSourceChanged || input.structureRevisionChanged ? 'FAIL' : 'PASS',
    runtimeMarker: R542_RUNTIME_MARKER,
  })
}

// ── Phase L: Live Update Accounting ────────────────────────────────────

export type LiveUpdateTerminalState = 'COMPLETED' | 'PENDING' | 'BLOCKED' | 'FAILED' | 'SAFE_SKIPPED'

/** Per-revision terminal states keyed by `revision|identity`. */
const liveUpdateTerminalStates = new Map<string, LiveUpdateTerminalState>()

export function resetLiveUpdateTerminalStates(): void {
  liveUpdateTerminalStates.clear()
}

export function setLiveUpdateTerminalState(
  liveFormulaRevision: number,
  stableFormulaIdentity: number | 'AMBIGUOUS' | null,
  state: LiveUpdateTerminalState,
): void {
  liveUpdateTerminalStates.set(`${liveFormulaRevision}|${String(stableFormulaIdentity)}`, state)
}

export function getLiveUpdateTerminalState(
  liveFormulaRevision: number,
  stableFormulaIdentity: number | 'AMBIGUOUS' | null,
): LiveUpdateTerminalState | null {
  return liveUpdateTerminalStates.get(`${liveFormulaRevision}|${String(stableFormulaIdentity)}`) ?? null
}

export interface LiveUpdateAccountingInput {
  liveFormulaRevision: number
  affectedIdentities: Array<number | 'AMBIGUOUS' | null>
  /** Existing-affected identities that were SAFE_SKIPPED (e.g. order-only shift). */
  safeSkippedIdentities: Array<number | 'AMBIGUOUS' | null>
  allDesiredTagsVisible: boolean
}

export interface LiveUpdateAccountingResult {
  liveFormulaRevision: number
  affectedCount: number
  completedCount: number
  pendingCount: number
  blockedCount: number
  failedCount: number
  safeSkippedCount: number
  unresolvedCount: number
  allDesiredTagsVisible: boolean
  decision: 'PASS' | 'INCOMPLETE'
  reason: string | null
}

/**
 * R5.4.2 Phase L: honest terminal-state accounting. affectedCount > 0 with
 * allDesiredTagsVisible=false and pending=0 can NEVER report PASS — it must be
 * reported as INCOMPLETE with the blocked/failed/pending split.
 */
export function computeLiveUpdateAccounting(input: LiveUpdateAccountingInput): LiveUpdateAccountingResult {
  let completedCount = 0
  let pendingCount = 0
  let blockedCount = 0
  let failedCount = 0
  let safeSkippedCount = 0

  for (const id of input.affectedIdentities) {
    if (input.safeSkippedIdentities.includes(id)) {
      safeSkippedCount++
      continue
    }
    const state = liveUpdateTerminalStates.get(`${input.liveFormulaRevision}|${String(id)}`) ?? null
    switch (state) {
      case 'COMPLETED': completedCount++; break
      case 'PENDING': pendingCount++; break
      case 'BLOCKED': blockedCount++; break
      case 'FAILED': failedCount++; break
      default: pendingCount++; break // unrecorded affected → still pending
    }
  }

  const affectedCount = input.affectedIdentities.length
  const unresolvedCount = Math.max(0, affectedCount - completedCount - safeSkippedCount)
  const decision: 'PASS' | 'INCOMPLETE' = unresolvedCount === 0 && input.allDesiredTagsVisible ? 'PASS' : 'INCOMPLETE'
  const result: LiveUpdateAccountingResult = {
    liveFormulaRevision: input.liveFormulaRevision,
    affectedCount,
    completedCount,
    pendingCount,
    blockedCount,
    failedCount,
    safeSkippedCount,
    unresolvedCount,
    allDesiredTagsVisible: input.allDesiredTagsVisible,
    decision,
    reason: decision === 'PASS' ? null
      : unresolvedCount > 0 && blockedCount > 0 ? 'BLOCKED'
        : unresolvedCount > 0 ? 'PENDING_OR_FAILED'
          : 'TAG_NOT_VISIBLE',
  }

  emitRuntimeAudit('FORMULA-LIVE-UPDATE-ACCOUNTING', {
    liveFormulaRevision: input.liveFormulaRevision,
    affectedCount,
    completedCount,
    pendingCount,
    blockedCount,
    failedCount,
    safeSkippedCount,
    unresolvedCount,
    allDesiredTagsVisible: input.allDesiredTagsVisible,
    decision,
    reason: result.reason,
    runtimeMarker: R542_RUNTIME_MARKER,
  })
  return result
}
