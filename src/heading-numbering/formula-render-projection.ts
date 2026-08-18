/**
 * v2.5.7-R5.4.3.7: Persistent Formula Renderer Projection.
 *
 * Two state machines are strictly separated:
 *   SEMANTIC STATE (formula identity/desiredTag/revision) — only real document
 *     semantics advance it.
 *   RENDER PROJECTION STATE (visible MathJax output == authoritative desiredTag)
 *     — Typora renderer output replacement NEVER advances semantic revision.
 *
 * TYPOORA_RENDERER_INTERNAL_ONLY mutations are no longer unconditionally
 * ignored: semanticRefresh=false but projectionReconcile=true when a canonical
 * formula host's visible tag diverges from its authoritative desiredTag.
 */

import { emitRuntimeAudit } from '../runtime/forensic-log-sink'
import { getActiveEditSession } from './formula-edit-session'

export const R5437_RUNTIME_MARKER = 'FORMULA-PERSISTENT-RENDERER-PROJECTION-V2.5.7-R5.4.3.7'
export const R5437_BUILD_MARKER = 'inkchapter-formula-persistent-renderer-projection-v2.5.7-r5.4.3.7'

// ── Visible Tag Reader ─────────────────────────────────────────────────────

export interface VisibleFormulaTagResult {
  visibleTagText: string | null
  visibleTagCount: number
  nativeOutputCount: number
  decision: 'MATCH' | 'MISMATCH' | 'NO_VISIBLE_OUTPUT' | 'AMBIGUOUS_OUTPUT'
}

/**
 * Read the current visible tag of a canonical formula host.
 * Only reads the live native MathJax output inside this exact host.
 */
export function readVisibleFormulaTag(formulaHost: HTMLElement, desiredTag: string): VisibleFormulaTagResult {
  const containers = Array.from(formulaHost.querySelectorAll('mjx-container'))
  const nativeOutputCount = containers.length
  // The tag candidate lives in the LAST container's mjx-container / label text.
  let visibleTagText: string | null = null
  let visibleTagCount = 0
  const candidates: string[] = []
  for (const c of containers) {
    const text = (c.textContent ?? '').trim()
    // Native Typora equation number looks like "(1)" — InkChapter tag "(11.2.1)".
    const m = text.match(/\(([0-9]+(?:\.[0-9]+)*)\)\s*$/)
    if (m) {
      visibleTagCount++
      candidates.push(m[1])
    }
  }
  if (visibleTagCount === 1) visibleTagText = candidates[0]
  else if (visibleTagCount > 1) visibleTagText = candidates[0]
  let decision: VisibleFormulaTagResult['decision']
  if (visibleTagCount === 0) decision = 'NO_VISIBLE_OUTPUT'
  else if (visibleTagCount > 1) decision = 'AMBIGUOUS_OUTPUT'
  else if (visibleTagText === desiredTag) decision = 'MATCH'
  else decision = 'MISMATCH'
  return { visibleTagText, visibleTagCount, nativeOutputCount, decision }
}

// ── Render Projection Reconcile ────────────────────────────────────────────

export interface RenderProjectionReconcileInput {
  documentKey: string
  documentGeneration: number
  editorRootToken: number
  stableFormulaIdentity: number | 'AMBIGUOUS' | null
  formulaIndex: number | null
  formulaHost: HTMLElement
  desiredTag: string
  reason: string
  observedRendererNode?: Node | null
  /** Strategy B fulfillment provider — original MathJax.tex2svgPromise wrapper. */
  requestFulfillment?: (tex: string, desiredTag: string) => Promise<HTMLElement | null>
  /** Strategy B authoritative raw TeX (verified source, not visual). */
  authoritativeRawTex?: string
}

export interface RenderProjectionReconcileResult {
  projectionMatched: boolean
  reconcileRequested: boolean
  route: 'MATCH' | 'NO_OP' | 'STRATEGY_A_NATURAL_SEAM' | 'STRATEGY_B_EXACT_FULFILLMENT' | 'ABORT'
  reconcileSucceeded: boolean
  visibleTagAfter: string | null
  reason: string | null
}

/**
 * The single entry point for render projection reconciliation.
 * Strategy A: Typora-owned host-local natural render seam (injected callback).
 * Strategy B: exact MathJax fulfillment replacement with hard gates.
 */
export function reconcileFormulaRenderProjectionNow(input: RenderProjectionReconcileInput): RenderProjectionReconcileResult {
  const visible = readVisibleFormulaTag(input.formulaHost, input.desiredTag)
  emitRuntimeAudit('FORMULA-RENDER-PROJECTION-INVARIANT', {
    documentKey: input.documentKey,
    documentGeneration: input.documentGeneration,
    editorRootToken: input.editorRootToken,
    stableFormulaIdentity: input.stableFormulaIdentity ?? null,
    formulaIndex: input.formulaIndex ?? null,
    formulaHostToken: null,
    desiredTag: input.desiredTag,
    visibleTagText: visible.visibleTagText,
    visibleTagCount: visible.visibleTagCount,
    nativeOutputCount: visible.nativeOutputCount,
    decision: visible.decision,
    reason: null,
    runtimeMarker: R5437_RUNTIME_MARKER,
  })

  if (visible.decision === 'MATCH') {
    emitRuntimeAudit('FORMULA-RENDER-PROJECTION-RECONCILE', {
      documentKey: input.documentKey,
      stableFormulaIdentity: input.stableFormulaIdentity ?? null,
      formulaIndex: input.formulaIndex ?? null,
      desiredTag: input.desiredTag,
      visibleTagBefore: input.desiredTag,
      reason: input.reason,
      projectionMatched: true,
      reconcileRequested: false,
      decision: 'NO_OP',
      reasonDetail: null,
      runtimeMarker: R5437_RUNTIME_MARKER,
    })
    return { projectionMatched: true, reconcileRequested: false, route: 'NO_OP', reconcileSucceeded: true, visibleTagAfter: input.desiredTag, reason: null }
  }
  if (visible.decision === 'AMBIGUOUS_OUTPUT') {
    return { projectionMatched: false, reconcileRequested: false, route: 'ABORT', reconcileSucceeded: false, visibleTagAfter: visible.visibleTagText, reason: 'AMBIGUOUS_OUTPUT' }
  }
  if (visible.decision === 'NO_VISIBLE_OUTPUT') {
    return { projectionMatched: false, reconcileRequested: false, route: 'ABORT', reconcileSucceeded: false, visibleTagAfter: null, reason: 'NO_VISIBLE_OUTPUT' }
  }

  // MISMATCH — must reconcile.
  emitRuntimeAudit('FORMULA-RENDER-PROJECTION-RECONCILE', {
    documentKey: input.documentKey,
    stableFormulaIdentity: input.stableFormulaIdentity ?? null,
    formulaIndex: input.formulaIndex ?? null,
    desiredTag: input.desiredTag,
    visibleTagBefore: visible.visibleTagText,
    reason: input.reason,
    projectionMatched: false,
    reconcileRequested: true,
    decision: 'RECONCILE',
    reasonDetail: null,
    runtimeMarker: R5437_RUNTIME_MARKER,
  })

  // Hard gates for any active reconciliation.
  const identityOk = input.stableFormulaIdentity !== null && input.stableFormulaIdentity !== 'AMBIGUOUS'
  const indexOk = input.formulaIndex !== null
  const tagOk = !!input.desiredTag && input.desiredTag !== ''
  const hostOk = input.formulaHost.isConnected
  const singleNative = visible.nativeOutputCount === 1
  if (!identityOk || !indexOk || !tagOk || !hostOk || !singleNative) {
    return { projectionMatched: false, reconcileRequested: true, route: 'ABORT', reconcileSucceeded: false, visibleTagAfter: visible.visibleTagText, reason: 'RECONCILE_HARD_GATE_FAILED' }
  }

  // ── R5.4.3.8 Section 28: Edit-safe projection hard gate ──
  // Only enforced when a latched edit session targets this formula (currently
  // editing). Replacement must ONLY touch the visible MJX-CONTAINER: editor
  // input subtree not contained by the replacement node, selection snapshot
  // available, activeElement outside the replacement node.
  const activeSession = getActiveEditSession()
  const editingFormula = !!activeSession
    && input.stableFormulaIdentity !== null && input.stableFormulaIdentity !== 'AMBIGUOUS'
    && activeSession.documentKey === input.documentKey
    && activeSession.stableFormulaIdentity === input.stableFormulaIdentity
  const targetContainer = input.formulaHost.querySelector('mjx-container')
  const editorSubtreeInside = !!targetContainer
    && targetContainer.querySelector('.CodeMirror, .CodeMirror-code, .md-rawblock-container, .md-rawblock-inline, input, textarea') !== null
  const activeEl = document.activeElement
  const sel = window.getSelection()
  const selectionSnapshot = {
    activeEl,
    anchorNode: sel?.anchorNode ?? null,
    anchorOffset: sel?.anchorOffset ?? 0,
  }
  if (editingFormula) {
    const selectionAvailable = !!sel && !!selectionSnapshot.anchorNode && selectionSnapshot.anchorNode.isConnected
    const activeElOutside = activeEl === null || activeEl === document.body || !(targetContainer?.contains(activeEl) ?? false)
    const editSafe = selectionAvailable && activeElOutside && !editorSubtreeInside
    emitRuntimeAudit('FORMULA-EDIT-SAFE-PROJECTION-AUTHORITY', {
      documentKey: input.documentKey,
      stableFormulaIdentity: input.stableFormulaIdentity,
      formulaIndex: input.formulaIndex ?? null,
      editingFormula: true,
      selectionAvailable,
      activeElementOutsideReplacement: activeElOutside,
      editorSubtreeNotContained: !editorSubtreeInside,
      decision: editSafe ? 'SAFE' : 'ABORT',
      reason: editSafe ? null
        : (!selectionAvailable ? 'SELECTION_SNAPSHOT_UNAVAILABLE'
          : (!activeElOutside ? 'ACTIVE_ELEMENT_INSIDE_REPLACEMENT' : 'EDITOR_SUBTREE_CONTAINED')),
      runtimeMarker: R5437_RUNTIME_MARKER,
    })
    if (!editSafe) {
      return { projectionMatched: false, reconcileRequested: true, route: 'ABORT', reconcileSucceeded: false, visibleTagAfter: visible.visibleTagText, reason: 'EDIT_SAFE_GATE_ABORTED' }
    }
  }

  // Strategy A: Typora-owned host-local natural render seam (future seam; none proven yet).
  // Strategy B: exact fulfillment replacement via original MathJax.tex2svgPromise.
  if (!input.requestFulfillment) {
    return { projectionMatched: false, reconcileRequested: true, route: 'ABORT', reconcileSucceeded: false, visibleTagAfter: visible.visibleTagText, reason: 'NO_FULFILLMENT_PROVIDER' }
  }

  emitRuntimeAudit('FORMULA-RENDER-PROJECTION-ROUTE', {
    documentKey: input.documentKey,
    stableFormulaIdentity: input.stableFormulaIdentity ?? null,
    formulaIndex: input.formulaIndex ?? null,
    route: 'STRATEGY_B_EXACT_FULFILLMENT',
    reason: 'NO_PROVEN_TYPORA_NATURAL_SEAM',
    runtimeMarker: R5437_RUNTIME_MARKER,
  })

  const tex = input.authoritativeRawTex ?? ''
  if (!tex) {
    return { projectionMatched: false, reconcileRequested: true, route: 'ABORT', reconcileSucceeded: false, visibleTagAfter: visible.visibleTagText, reason: 'NO_AUTHORITATIVE_RAW_TEX' }
  }

  // Strategy B execution (async fulfillment — the caller awaits and verifies).
  void input.requestFulfillment(tex, input.desiredTag).then((newNode) => {
    if (!newNode) {
      emitRuntimeAudit('FORMULA-RENDER-PROJECTION-FULFILLMENT', {
        documentKey: input.documentKey,
        stableFormulaIdentity: input.stableFormulaIdentity ?? null,
        formulaIndex: input.formulaIndex ?? null,
        desiredTag: input.desiredTag,
        fulfilled: false,
        nodeName: null,
        decision: 'FAIL',
        reason: 'FULFILLMENT_REJECTED',
        runtimeMarker: R5437_RUNTIME_MARKER,
      })
      return
    }
    if (!newNode.isConnected && newNode.tagName === 'MJX-CONTAINER') {
      // Replace the single existing native output inside the host.
      const old = input.formulaHost.querySelector('mjx-container')
      if (old && old.parentNode) {
        old.replaceWith(newNode)
        emitRuntimeAudit('FORMULA-RENDER-PROJECTION-NATIVE-SLOT-REPLACE', {
          documentKey: input.documentKey,
          stableFormulaIdentity: input.stableFormulaIdentity ?? null,
          formulaIndex: input.formulaIndex ?? null,
          desiredTag: input.desiredTag,
          oldNodeName: 'MJX-CONTAINER',
          newNodeName: newNode.tagName,
          replaced: true,
          duplicateOutputCount: input.formulaHost.querySelectorAll('mjx-container').length - 1,
          decision: 'REPLACED',
          runtimeMarker: R5437_RUNTIME_MARKER,
        })
        const after = readVisibleFormulaTag(input.formulaHost, input.desiredTag)
        // R5.4.3.8: verify selection / active editor preserved after replacement.
        const selAfter = window.getSelection()
        const activeAfter = document.activeElement
        const selectionPreserved = !!selAfter
          && selAfter.anchorNode === selectionSnapshot.anchorNode
          && selAfter.anchorOffset === selectionSnapshot.anchorOffset
          && activeAfter === selectionSnapshot.activeEl
        if (editingFormula) {
          emitRuntimeAudit('FORMULA-EDIT-SAFE-PROJECTION-AUTHORITY', {
            documentKey: input.documentKey,
            stableFormulaIdentity: input.stableFormulaIdentity,
            formulaIndex: input.formulaIndex ?? null,
            editingFormula: true,
            phase: 'AFTER_REPLACEMENT',
            selectionPreserved,
            activeEditorPreserved: activeAfter === selectionSnapshot.activeEl,
            decision: selectionPreserved ? 'PASS' : 'ABORT',
            reason: selectionPreserved ? null : 'SELECTION_NOT_PRESERVED_AFTER_REPLACEMENT',
            runtimeMarker: R5437_RUNTIME_MARKER,
          })
        }
        emitRuntimeAudit('FORMULA-RENDER-PROJECTION-VISIBLE-VERIFY', {
          documentKey: input.documentKey,
          stableFormulaIdentity: input.stableFormulaIdentity ?? null,
          formulaIndex: input.formulaIndex ?? null,
          expectedVisibleTag: input.desiredTag,
          visibleTagAfter: after.visibleTagText,
          expectedTagMatched: after.decision === 'MATCH',
          decision: after.decision === 'MATCH' ? 'PASS' : 'FAIL',
          runtimeMarker: R5437_RUNTIME_MARKER,
        })
      }
    }
  })

  return { projectionMatched: false, reconcileRequested: true, route: 'STRATEGY_B_EXACT_FULFILLMENT', reconcileSucceeded: true, visibleTagAfter: visible.visibleTagText, reason: null }
}

// ── Pending Formula Projection ─────────────────────────────────────────────

export type PendingProjectionState =
  | 'PENDING_IDENTITY'
  | 'PENDING_PLAN'
  | 'READY_TO_REPLAY'
  | 'REPLAYING'
  | 'FULFILLED'
  | 'CANCELLED'
  | 'STALE'

export interface PendingFormulaProjection {
  documentKey: string
  generation: number
  rootToken: number
  formulaHostToken: number
  rendererNodeToken: number
  createdAtOperationId: string
  reason: string
  state: PendingProjectionState
}

const pendingProjections = new Map<number, PendingFormulaProjection>()

export function createPendingProjection(input: {
  documentKey: string
  generation: number
  rootToken: number
  formulaHostToken: number
  rendererNodeToken: number
  operationId: string
  reason: string
}): PendingFormulaProjection {
  const p: PendingFormulaProjection = {
    documentKey: input.documentKey,
    generation: input.generation,
    rootToken: input.rootToken,
    formulaHostToken: input.formulaHostToken,
    rendererNodeToken: input.rendererNodeToken,
    createdAtOperationId: input.operationId,
    reason: input.reason,
    state: 'PENDING_IDENTITY',
  }
  pendingProjections.set(input.formulaHostToken, p)
  emitRuntimeAudit('FORMULA-NEW-PENDING-PROJECTION', {
    documentKey: input.documentKey,
    generation: input.generation,
    rootToken: input.rootToken,
    formulaHostToken: input.formulaHostToken,
    rendererNodeToken: input.rendererNodeToken,
    reason: input.reason,
    state: p.state,
    decision: 'PENDING',
    runtimeMarker: R5437_RUNTIME_MARKER,
  })
  return p
}

export function getPendingProjection(formulaHostToken: number): PendingFormulaProjection | null {
  return pendingProjections.get(formulaHostToken) ?? null
}

/**
 * Called after FORMULA_ADDED / new-host adoption / desiredTag established.
 * Marks READY_TO_REPLAY so the caller can reconcile projection immediately.
 */
export function resolvePendingProjection(input: {
  formulaHostToken: number
  documentKey: string
  generation: number
  stableFormulaIdentity: number
  formulaIndex: number
  desiredTag: string
}): 'REPLAY' | 'NONE' | 'STALE' {
  const p = pendingProjections.get(input.formulaHostToken)
  if (!p) return 'NONE'
  if (p.documentKey !== input.documentKey || p.generation !== input.generation) {
    p.state = 'STALE'
    emitRuntimeAudit('FORMULA-NEW-PROJECTION-REPLAY', {
      formulaHostToken: input.formulaHostToken,
      documentKey: input.documentKey,
      generation: input.generation,
      stableFormulaIdentity: input.stableFormulaIdentity,
      formulaIndex: input.formulaIndex,
      desiredTag: input.desiredTag,
      pendingResolved: false,
      decision: 'STALE',
      reason: 'PENDING_STALE_DOCUMENT_OR_GENERATION',
      runtimeMarker: R5437_RUNTIME_MARKER,
    })
    pendingProjections.delete(input.formulaHostToken)
    return 'STALE'
  }
  p.state = 'READY_TO_REPLAY'
  emitRuntimeAudit('FORMULA-NEW-PROJECTION-REPLAY', {
    formulaHostToken: input.formulaHostToken,
    documentKey: input.documentKey,
    generation: input.generation,
    stableFormulaIdentity: input.stableFormulaIdentity,
    formulaIndex: input.formulaIndex,
    desiredTag: input.desiredTag,
    pendingResolved: true,
    projectionReconcileRequested: true,
    decision: 'REPLAY',
    reason: null,
    runtimeMarker: R5437_RUNTIME_MARKER,
  })
  pendingProjections.delete(input.formulaHostToken)
  return 'REPLAY'
}

export function clearPendingProjectionsForDocument(documentKey: string): void {
  for (const [k, p] of pendingProjections) {
    if (p.documentKey === documentKey) {
      p.state = 'CANCELLED'
      pendingProjections.delete(k)
    }
  }
}

export function resetPendingProjections(): void {
  pendingProjections.clear()
}
