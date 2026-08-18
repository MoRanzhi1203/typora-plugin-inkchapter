/**
 * v2.5.7-R5.4.3.9: Persistent Formula Renderer Projection.
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
import { getActiveEditSession, getCurrentTransaction } from './formula-edit-session'
import { simpleHash, normalizeTexSource } from './formula-tex-source-verifier'
import type { FormulaStableIdentity } from './formula-state-store'

export const R5439_RUNTIME_MARKER = 'FORMULA-PERSISTENT-RENDERER-PROJECTION-V2.5.7-R5.4.3.9'
export const R5439_BUILD_MARKER = 'inkchapter-formula-persistent-renderer-projection-v2.5.7-r5.4.3.9'

// ── Renderer Node Reverse Binding Registry ─────────────────────────────────

export interface RendererNodeBinding {
  formulaHostToken: number
  stableFormulaIdentity: FormulaStableIdentity
  formulaIndex: number
  documentKey: string
  generation: number
  rootToken: number
  bindingSource: 'TEX2SVG_FULFILLMENT' | 'EDIT_SESSION_LATCH' | 'MUTATION_OBSERVER'
}

const fulfillmentNodeRegistry = new WeakMap<Node, RendererNodeBinding>()

export function registerFulfillmentNodeBinding(
  node: Node,
  binding: RendererNodeBinding
): void {
  fulfillmentNodeRegistry.set(node, binding)
  emitRuntimeAudit('FORMULA-RENDERER-NODE-BINDING-AUTHORITY', {
    fulfillmentNodeToken: null,
    formulaHostToken: binding.formulaHostToken,
    stableFormulaIdentity: binding.stableFormulaIdentity,
    formulaIndex: binding.formulaIndex,
    documentKey: binding.documentKey,
    generation: binding.generation,
    rootToken: binding.rootToken,
    bindingSource: binding.bindingSource,
    decision: 'REGISTERED',
    runtimeMarker: 'FORMULA-ATOMIC-TRANSACTION-RENDER-PROJECTION-V2.5.7-R5.4.3.9',
  })
}

export function resolveRendererNodeBinding(node: Node): RendererNodeBinding | null {
  return fulfillmentNodeRegistry.get(node) ?? null
}

export function resolveCanonicalHostFromRendererNode(
  node: Node,
  root: HTMLElement | null
): { host: HTMLElement | null; source: 'REGISTRY' | 'CLOSEST' | 'FAILED' } {
  // 1. Try registry
  const binding = fulfillmentNodeRegistry.get(node)
  if (binding) {
    // We can't resolve the actual HTMLElement from the token, so we need to search
    // This is a limitation — tokens are opaque. But we can use the registry for
    // identity resolution even without the host element.
    return { host: null, source: 'REGISTRY' }
  }
  // 2. Try closest() (only works for connected nodes)
  if (node instanceof HTMLElement) {
    const host = node.closest('.mathjax-block, .md-math-block') as HTMLElement | null
    if (host) return { host, source: 'CLOSEST' }
  }
  if (node.parentElement) {
    const host = node.parentElement.closest('.mathjax-block, .md-math-block') as HTMLElement | null
    if (host) return { host, source: 'CLOSEST' }
  }
  return { host: null, source: 'FAILED' }
}

export function resetFulfillmentNodeRegistry(): void {
  // WeakMap auto-cleans; no explicit clear needed
}

// ── Original MathJax.tex2svgPromise Reference ──────────────────────────────

let originalTex2svgPromise: ((...args: unknown[]) => Promise<unknown>) | null = null

export function setOriginalTex2svgPromise(fn: (...args: unknown[]) => Promise<unknown>): void {
  originalTex2svgPromise = fn
}

export function getOriginalTex2svgPromise(): ((...args: unknown[]) => Promise<unknown>) | null {
  return originalTex2svgPromise
}

// ── Natural Render Options Cache ───────────────────────────────────────────

export interface NaturalRenderOptions {
  em?: number
  ex?: number
  containerWidth?: number
  scale?: number
  family?: string
  display?: boolean
}

const naturalRenderOptionsCache = new Map<FormulaStableIdentity, NaturalRenderOptions>()

export function cacheNaturalRenderOptions(
  stableFormulaIdentity: FormulaStableIdentity,
  options: NaturalRenderOptions
): void {
  naturalRenderOptionsCache.set(stableFormulaIdentity, options)
  emitRuntimeAudit('FORMULA-NATURAL-RENDER-OPTIONS-AUTHORITY', {
    stableFormulaIdentity,
    optionsAvailable: true,
    decision: 'CACHED',
    runtimeMarker: 'FORMULA-ATOMIC-TRANSACTION-RENDER-PROJECTION-V2.5.7-R5.4.3.9',
  })
}

export function getNaturalRenderOptions(stableFormulaIdentity: FormulaStableIdentity): NaturalRenderOptions | null {
  return naturalRenderOptionsCache.get(stableFormulaIdentity) ?? null
}

// ── Production Fulfillment Provider ────────────────────────────────────────

export interface ProjectionFulfillmentRequest {
  stableFormulaIdentity: FormulaStableIdentity
  formulaIndex: number
  rawTex: string
  desiredTag: string
  planRevision: number
  liveFormulaRevision: number
  documentKey: string
  generation: number
  rootToken: number
  /** R5.4.3.19: separate renderer binding token — NEVER aliases business identity. */
  formulaHostToken?: number
}

export interface ProjectionFulfillmentResult {
  fulfilled: boolean
  resultNode: HTMLElement | null
  decision: 'FULFILLED' | 'NO_PROVIDER' | 'STALE' | 'FAILED'
  reason: string | null
}

export async function requestFormulaProjectionFulfillment(
  request: ProjectionFulfillmentRequest,
  options?: NaturalRenderOptions,
): Promise<ProjectionFulfillmentResult> {
  if (!originalTex2svgPromise) {
    return { fulfilled: false, resultNode: null, decision: 'NO_PROVIDER', reason: 'ORIGINAL_TEX2SVG_PROMISE_NOT_AVAILABLE' }
  }

  emitRuntimeAudit('FORMULA-PROJECTION-FULFILLMENT-PROVIDER', {
    stableFormulaIdentity: request.stableFormulaIdentity,
    formulaIndex: request.formulaIndex,
    rawTexHash: simpleHash(normalizeTexSource(request.rawTex)),
    desiredTag: request.desiredTag,
    optionsAvailable: !!options,
    providerKind: 'ORIGINAL_TEX2SVG_PROMISE',
    requestIssued: true,
    fulfilled: false,
    resultNodeName: null,
    resultNodeToken: null,
    decision: 'REQUESTED',
    runtimeMarker: 'FORMULA-ATOMIC-TRANSACTION-RENDER-PROJECTION-V2.5.7-R5.4.3.9',
  })

  try {
    const rawTex = request.rawTex.trim()
    // Build the injected tex with \tag{desiredTag}
    const { buildInjectedTex } = await import('./mathjax-tex2svg-tag-injection')
    const injected = buildInjectedTex(rawTex, request.desiredTag)
    const result = await originalTex2svgPromise(injected.injectedTex, options ?? {})

    let resultNode: HTMLElement | null = null
    if (result instanceof HTMLElement) {
      resultNode = result
    } else if (result && typeof (result as any).nodeName === 'string') {
      resultNode = result as HTMLElement
    } else if (Array.isArray(result) && result.length > 0 && result[0] instanceof HTMLElement) {
      resultNode = result[0]
    }

    if (resultNode) {
      // Register the binding — business stable identity is preserved as-is.
      registerFulfillmentNodeBinding(resultNode, {
        formulaHostToken: request.formulaHostToken ?? (typeof request.stableFormulaIdentity === 'number' ? request.stableFormulaIdentity : 0),
        stableFormulaIdentity: request.stableFormulaIdentity,
        formulaIndex: request.formulaIndex,
        documentKey: request.documentKey,
        generation: request.generation,
        rootToken: request.rootToken,
        bindingSource: 'TEX2SVG_FULFILLMENT',
      })

      emitRuntimeAudit('FORMULA-PROJECTION-FULFILLMENT-PROVIDER', {
        stableFormulaIdentity: request.stableFormulaIdentity,
        formulaIndex: request.formulaIndex,
        rawTexHash: simpleHash(normalizeTexSource(request.rawTex)),
        desiredTag: request.desiredTag,
        optionsAvailable: !!options,
        providerKind: 'ORIGINAL_TEX2SVG_PROMISE',
        requestIssued: true,
        fulfilled: true,
        resultNodeName: resultNode.tagName,
        resultNodeToken: null,
        decision: 'FULFILLED',
        runtimeMarker: 'FORMULA-ATOMIC-TRANSACTION-RENDER-PROJECTION-V2.5.7-R5.4.3.9',
      })
    }

    return { fulfilled: !!resultNode, resultNode, decision: resultNode ? 'FULFILLED' : 'FAILED', reason: resultNode ? null : 'FULFILLMENT_RETURNED_NO_NODE' }
  } catch (err) {
    emitRuntimeAudit('FORMULA-PROJECTION-FULFILLMENT-PROVIDER', {
      stableFormulaIdentity: request.stableFormulaIdentity,
      formulaIndex: request.formulaIndex,
      rawTexHash: simpleHash(normalizeTexSource(request.rawTex)),
      desiredTag: request.desiredTag,
      optionsAvailable: !!options,
      providerKind: 'ORIGINAL_TEX2SVG_PROMISE',
      requestIssued: true,
      fulfilled: false,
      resultNodeName: null,
      resultNodeToken: null,
      decision: 'FAILED',
      reason: `FULFILLMENT_EXCEPTION: ${(err as Error)?.message ?? String(err)}`,
      runtimeMarker: 'FORMULA-ATOMIC-TRANSACTION-RENDER-PROJECTION-V2.5.7-R5.4.3.9',
    })
    return { fulfilled: false, resultNode: null, decision: 'FAILED', reason: 'FULFILLMENT_EXCEPTION' }
  }
}

// ── Affected Existing Projection Closure ───────────────────────────────────

export function emitAffectedExistingProjectionClosure(input: {
  affectedCount: number
  requestedCount: number
  providerAvailableCount: number
  fulfilledCount: number
  appliedCount: number
  visibleVerifiedCount: number
  failedCount: number
  pendingCount: number
  allDesiredTagsVisible: boolean
  decision: string
  reason: string | null
}): void {
  emitRuntimeAudit('FORMULA-AFFECTED-EXISTING-PROJECTION-CLOSURE', {
    ...input,
    runtimeMarker: 'FORMULA-ATOMIC-TRANSACTION-RENDER-PROJECTION-V2.5.7-R5.4.3.9',
  })
}

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
    runtimeMarker: R5439_RUNTIME_MARKER,
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
      runtimeMarker: R5439_RUNTIME_MARKER,
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
    runtimeMarker: R5439_RUNTIME_MARKER,
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
      runtimeMarker: R5439_RUNTIME_MARKER,
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
    runtimeMarker: R5439_RUNTIME_MARKER,
  })

  const tex = input.authoritativeRawTex ?? ''
  if (!tex) {
    return { projectionMatched: false, reconcileRequested: true, route: 'ABORT', reconcileSucceeded: false, visibleTagAfter: visible.visibleTagText, reason: 'NO_AUTHORITATIVE_RAW_TEX' }
  }

  // Strategy B execution (async fulfillment — the caller awaits and verifies).
  void input.requestFulfillment(tex, input.desiredTag).then((newNode) => {
    // Track counts for closure emission
    let fulfilledCount = 0
    let appliedCount = 0
    let visibleVerifiedCount = 0

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
        runtimeMarker: R5439_RUNTIME_MARKER,
      })
      emitAffectedExistingProjectionClosure({
        affectedCount: 1,
        requestedCount: 1,
        providerAvailableCount: 1,
        fulfilledCount: 0,
        appliedCount: 0,
        visibleVerifiedCount: 0,
        failedCount: 1,
        pendingCount: 0,
        allDesiredTagsVisible: false,
        decision: 'FAIL',
        reason: 'FULFILLMENT_REJECTED',
      })
      return
    }
    fulfilledCount = 1
    if (!newNode.isConnected && newNode.tagName === 'MJX-CONTAINER') {
      // Replace the single existing native output inside the host.
      const old = input.formulaHost.querySelector('mjx-container')
      if (old && old.parentNode) {
        // Register the binding for the new node before replacement
        const identity = input.stableFormulaIdentity
        const index = input.formulaIndex
        if (identity !== null && identity !== 'AMBIGUOUS' && index !== null) {
          registerFulfillmentNodeBinding(newNode, {
            formulaHostToken: identity,
            stableFormulaIdentity: identity,
            formulaIndex: index,
            documentKey: input.documentKey,
            generation: input.documentGeneration,
            rootToken: input.editorRootToken,
            bindingSource: 'TEX2SVG_FULFILLMENT',
          })
        }
        old.replaceWith(newNode)
        appliedCount = 1
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
          runtimeMarker: R5439_RUNTIME_MARKER,
        })
        const after = readVisibleFormulaTag(input.formulaHost, input.desiredTag)
        // R5.4.3.9: verify selection / active editor preserved after replacement.
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
            runtimeMarker: R5439_RUNTIME_MARKER,
          })
        }
        const visibleVerified = after.decision === 'MATCH'
        if (visibleVerified) visibleVerifiedCount = 1
        emitRuntimeAudit('FORMULA-RENDER-PROJECTION-VISIBLE-VERIFY', {
          documentKey: input.documentKey,
          stableFormulaIdentity: input.stableFormulaIdentity ?? null,
          formulaIndex: input.formulaIndex ?? null,
          expectedVisibleTag: input.desiredTag,
          visibleTagAfter: after.visibleTagText,
          expectedTagMatched: visibleVerified,
          decision: visibleVerified ? 'PASS' : 'FAIL',
          runtimeMarker: R5439_RUNTIME_MARKER,
        })
        // Emit full-chain closure
        emitAffectedExistingProjectionClosure({
          affectedCount: 1,
          requestedCount: 1,
          providerAvailableCount: 1,
          fulfilledCount,
          appliedCount,
          visibleVerifiedCount,
          failedCount: visibleVerified ? 0 : 1,
          pendingCount: 0,
          allDesiredTagsVisible: visibleVerified,
          decision: visibleVerified ? 'PASS' : 'FAIL',
          reason: visibleVerified ? null : 'VISIBLE_VERIFY_FAILED',
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
    runtimeMarker: R5439_RUNTIME_MARKER,
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
      runtimeMarker: R5439_RUNTIME_MARKER,
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
    runtimeMarker: R5439_RUNTIME_MARKER,
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

// ── Native Slot Ownership Authority ─────────────────────────────────────────

export function emitNativeSlotOwnershipAuthority(input: {
  formulaHostToken: number | null
  formulaHostTag: string
  formulaHostClass: string
  oldOutputNodeToken: number | null
  oldOutputNodeName: string | null
  oldOutputParentToken: number | null
  oldOutputParentTag: string | null
  oldOutputParentClass: string | null
  oldOutputContainedByFormulaHost: boolean
  oldOutputIsFormulaHost: boolean
  oldOutputIsAncestorOfFormulaHost: boolean
  nativeVisibleOutputCount: number
  targetSlotCount: number
  decision: string
  reason: string | null
}): void {
  emitRuntimeAudit('FORMULA-NATIVE-SLOT-OWNERSHIP-AUTHORITY', {
    ...input,
    runtimeMarker: 'FORMULA-ATOMIC-TRANSACTION-RENDER-PROJECTION-V2.5.7-R5.4.3.9',
  })
}

export interface NativeSlotOwnershipCheckInput {
  formulaHost: HTMLElement
  targetNode: Node | null
}

export interface NativeSlotOwnershipCheckResult {
  allowed: boolean
  oldOutputContainedByFormulaHost: boolean
  oldOutputIsFormulaHost: boolean
  oldOutputIsAncestorOfFormulaHost: boolean
  nativeVisibleOutputCount: number
  targetSlotCount: number
  decision: string
  reason: string | null
}

export function checkNativeSlotOwnership(input: NativeSlotOwnershipCheckInput): NativeSlotOwnershipCheckResult {
  const host = input.formulaHost
  const target = input.targetNode
  const mjxContainers = host.querySelectorAll('mjx-container')
  const nativeVisibleOutputCount = mjxContainers.length
  const targetSlotCount = target && target.parentNode ? 1 : 0

  let oldOutputContainedByFormulaHost = false
  let oldOutputIsFormulaHost = false
  let oldOutputIsAncestorOfFormulaHost = false

  if (target instanceof Node) {
    oldOutputContainedByFormulaHost = host.contains(target)
    oldOutputIsFormulaHost = target === host
    oldOutputIsAncestorOfFormulaHost = target.contains(host)
  }

  const allowed = oldOutputContainedByFormulaHost && !oldOutputIsFormulaHost && !oldOutputIsAncestorOfFormulaHost && nativeVisibleOutputCount === 1 && targetSlotCount === 1

  emitNativeSlotOwnershipAuthority({
    formulaHostToken: null,
    formulaHostTag: host.tagName,
    formulaHostClass: (host.className || '').slice(0, 80),
    oldOutputNodeToken: null,
    oldOutputNodeName: target?.nodeName ?? null,
    oldOutputParentToken: null,
    oldOutputParentTag: target?.parentNode instanceof Element ? target.parentNode.tagName : null,
    oldOutputParentClass: target?.parentNode instanceof Element ? (target.parentNode.className || '').slice(0, 80) : null,
    oldOutputContainedByFormulaHost,
    oldOutputIsFormulaHost,
    oldOutputIsAncestorOfFormulaHost,
    nativeVisibleOutputCount,
    targetSlotCount,
    decision: allowed ? 'PASS' : 'ABORT',
    reason: allowed ? null
      : (!oldOutputContainedByFormulaHost ? 'TARGET_OUTSIDE_FORMULA_HOST'
        : oldOutputIsFormulaHost ? 'TARGET_IS_FORMULA_HOST'
          : oldOutputIsAncestorOfFormulaHost ? 'TARGET_IS_ANCESTOR_OF_FORMULA_HOST'
            : nativeVisibleOutputCount !== 1 ? 'EXPECTED_EXACTLY_ONE_NATIVE_OUTPUT'
              : 'TARGET_SLOT_COUNT_MISMATCH'),
  })

  return {
    allowed,
    oldOutputContainedByFormulaHost,
    oldOutputIsFormulaHost,
    oldOutputIsAncestorOfFormulaHost,
    nativeVisibleOutputCount,
    targetSlotCount,
    decision: allowed ? 'PASS' : 'ABORT',
    reason: allowed ? null : 'NATIVE_SLOT_OWNERSHIP_FAILED',
  }
}

// ── Document Visual Integrity Gate ──────────────────────────────────────────

export interface VisualIntegritySnapshotEntry {
  nodeToken: number | null
  tag: string
  classList: string
  mdtype: string
  connected: boolean
  display: string
  visibility: string
  rectHeight: number
  offsetHeight: number
  clientHeight: number
  previousSiblingToken: number | null
  nextSiblingToken: number | null
}

export interface VisualIntegritySnapshot {
  beforeSnapshot: VisualIntegritySnapshotEntry[]
  afterSnapshot: VisualIntegritySnapshotEntry[]
  nonTargetBlockCount: number
  nonTargetBlockDisappearedCount: number
  nonTargetBlockHeightZeroCount: number
  nonTargetBlockOrderChanged: boolean
  formulaHostConnected: boolean
  formulaHostRectHeight: number
  decision: string
  reason: string | null
}

/**
 * Capture a snapshot of the top-level editor blocks around a formula host.
 * Records previous 5 blocks, target formula, next 10 blocks.
 */
export function captureVisualIntegritySnapshot(
  formulaHost: HTMLElement,
  editorRoot: HTMLElement | null,
): VisualIntegritySnapshotEntry[] {
  if (!editorRoot) return []
  const snapshot: VisualIntegritySnapshotEntry[] = []
  try {
    const allBlocks = Array.from(editorRoot.children)
    const hostIdx = allBlocks.indexOf(formulaHost)
    if (hostIdx === -1) return []
    const start = Math.max(0, hostIdx - 5)
    const end = Math.min(allBlocks.length, hostIdx + 11)
    for (let i = start; i < end; i++) {
      const b = allBlocks[i]
      const cs = b instanceof HTMLElement ? window.getComputedStyle(b) : null
      snapshot.push({
        nodeToken: null,
        tag: b.tagName,
        classList: (b instanceof HTMLElement ? (b.className || '') : '').slice(0, 80),
        mdtype: (b instanceof HTMLElement && b.getAttribute('mdtype')) || '',
        connected: b.isConnected,
        display: cs?.display ?? '',
        visibility: cs?.visibility ?? '',
        rectHeight: b instanceof HTMLElement ? b.getBoundingClientRect().height : 0,
        offsetHeight: b instanceof HTMLElement ? b.offsetHeight : 0,
        clientHeight: b instanceof HTMLElement ? b.clientHeight : 0,
        previousSiblingToken: null,
        nextSiblingToken: null,
      })
    }
  } catch { /* ignore */ }
  return snapshot
}

/**
 * Compare before/after snapshots and verify visual integrity.
 * Only the target formula host's MJX output may change — all other blocks
 * must remain connected, visible, and in the same order.
 */
export function verifyVisualIntegrity(
  formulaHost: HTMLElement,
  editorRoot: HTMLElement | null,
  beforeSnapshot: VisualIntegritySnapshotEntry[],
): VisualIntegritySnapshot {
  if (!editorRoot || beforeSnapshot.length === 0) {
    return {
      beforeSnapshot,
      afterSnapshot: [],
      nonTargetBlockCount: 0,
      nonTargetBlockDisappearedCount: 0,
      nonTargetBlockHeightZeroCount: 0,
      nonTargetBlockOrderChanged: false,
      formulaHostConnected: formulaHost.isConnected,
      formulaHostRectHeight: formulaHost instanceof HTMLElement ? formulaHost.getBoundingClientRect().height : 0,
      decision: 'SKIP',
      reason: 'NO_EDITOR_ROOT_OR_BEFORE_SNAPSHOT',
    }
  }
  const afterSnapshot = captureVisualIntegritySnapshot(formulaHost, editorRoot)
  let disappearedCount = 0
  let heightZeroCount = 0
  let orderChanged = false
  for (let i = 0; i < Math.min(beforeSnapshot.length, afterSnapshot.length); i++) {
    const before = beforeSnapshot[i]
    const after = afterSnapshot[i]
    if (before.tag !== after.tag || before.classList !== after.classList) {
      orderChanged = true
    }
    if (before.connected && !after.connected) disappearedCount++
    if (before.rectHeight > 0 && after.rectHeight === 0) heightZeroCount++
  }
  const nonTargetCount = Math.min(beforeSnapshot.length, afterSnapshot.length)
  const pass = disappearedCount === 0 && heightZeroCount === 0 && !orderChanged && formulaHost.isConnected
  emitRuntimeAudit('DOCUMENT-VISUAL-INTEGRITY-GATE', {
    nonTargetBlockCount: nonTargetCount,
    nonTargetBlockDisappearedCount: disappearedCount,
    nonTargetBlockHeightZeroCount: heightZeroCount,
    nonTargetBlockOrderChanged: orderChanged,
    formulaHostConnected: formulaHost.isConnected,
    formulaHostRectHeight: formulaHost instanceof HTMLElement ? formulaHost.getBoundingClientRect().height : 0,
    decision: pass ? 'PASS' : 'FAIL',
    reason: pass ? null
      : (disappearedCount > 0 ? 'NON_TARGET_BLOCK_DISAPPEARED'
        : heightZeroCount > 0 ? 'NON_TARGET_BLOCK_HEIGHT_ZERO'
          : orderChanged ? 'NON_TARGET_BLOCK_ORDER_CHANGED'
            : 'FORMULA_HOST_DISCONNECTED'),
    runtimeMarker: 'FORMULA-ATOMIC-TRANSACTION-RENDER-PROJECTION-V2.5.7-R5.4.3.9',
  })
  return {
    beforeSnapshot,
    afterSnapshot,
    nonTargetBlockCount: nonTargetCount,
    nonTargetBlockDisappearedCount: disappearedCount,
    nonTargetBlockHeightZeroCount: heightZeroCount,
    nonTargetBlockOrderChanged: orderChanged,
    formulaHostConnected: formulaHost.isConnected,
    formulaHostRectHeight: formulaHost instanceof HTMLElement ? formulaHost.getBoundingClientRect().height : 0,
    decision: pass ? 'PASS' : 'FAIL',
    reason: pass ? null : 'VISUAL_INTEGRITY_FAILED',
  }
}

// ── Formula Composite Visual Owner ──────────────────────────────────────────

export interface FormulaCompositeVisualOwner {
  sourceHost: HTMLElement | null
  compositeOwner: HTMLElement | null
  previewHost: HTMLElement | null
  nativeMjxOutput: HTMLElement | null
  sourceHostContainedByOwner: boolean
  previewHostContainedByOwner: boolean
  nativeOutputContainedByOwner: boolean
  nativeOutputCountWithinOwner: number
  otherFormulaSourceHostCountWithinOwner: number | null
  decision: string
  reason: string | null
}

/**
 * Resolve the composite visual owner for a block formula.
 *
 * Typora block formula structure:
 *   FormulaCompositeOwner (e.g. .md-math-block)
 *   ├── source/edit host (.md-rawblock-container.md-math-container or .MathJax_Display)
 *   └── preview/output host (.md-mathjax-preview)
 *       └── MJX-CONTAINER
 *
 * The sourceHost and previewHost are siblings under one composite owner.
 * This is NOT a simple sourceHost.contains(MJX) relationship.
 */
export function resolveFormulaCompositeVisualOwner(
  formulaHost: HTMLElement | null,
  editorRoot: HTMLElement | null,
): FormulaCompositeVisualOwner {
  if (!formulaHost || !editorRoot) {
    return {
      sourceHost: formulaHost,
      compositeOwner: null,
      previewHost: null,
      nativeMjxOutput: null,
      sourceHostContainedByOwner: false,
      previewHostContainedByOwner: false,
      nativeOutputContainedByOwner: false,
      nativeOutputCountWithinOwner: 0,
      otherFormulaSourceHostCountWithinOwner: 0,
      decision: 'FAIL',
      reason: 'NO_FORMULA_HOST_OR_EDITOR_ROOT',
    }
  }

  // Find the composite owner: the closest common ancestor of sourceHost and previewHost.
  // For Typora, this is typically the .md-math-block or .mathjax-block element.
  let compositeOwner: HTMLElement | null = formulaHost.closest('.md-math-block, .mathjax-block')
  if (!compositeOwner) {
    // Fallback: use the formulaHost's parent if it's a suitable container.
    compositeOwner = formulaHost.parentElement instanceof HTMLElement ? formulaHost.parentElement : null
  }

  // The preview host is typically .md-mathjax-preview inside the composite owner.
  const previewHost = compositeOwner
    ? compositeOwner.querySelector<HTMLElement>('.md-mathjax-preview, .md-rawblock-container.md-math-container')
    : null

  // The native MJX output is inside the preview host.
  const nativeMjxOutput = previewHost
    ? previewHost.querySelector<HTMLElement>('mjx-container')
    : (compositeOwner ? compositeOwner.querySelector<HTMLElement>('mjx-container') : null)

  const sourceHostContainedByOwner = !!compositeOwner && !!formulaHost && compositeOwner.contains(formulaHost)
  const previewHostContainedByOwner = !!compositeOwner && !!previewHost && compositeOwner.contains(previewHost)
  const nativeOutputContainedByOwner = !!compositeOwner && !!nativeMjxOutput && compositeOwner.contains(nativeMjxOutput)

  // Count native MJX outputs within the composite owner.
  const nativeOutputCountWithinOwner = compositeOwner
    ? compositeOwner.querySelectorAll('mjx-container').length
    : 0

  // Count other formula source hosts within the same composite owner.
  let otherFormulaSourceHostCountWithinOwner: number | null | null = null
  if (compositeOwner) {
    try {
      const count = compositeOwner.querySelectorAll('.md-math-block, .mathjax-block').length
      otherFormulaSourceHostCountWithinOwner = count - 1
    } catch {
      otherFormulaSourceHostCountWithinOwner = null // UNKNOWN
    }
  }

  const otherFormulaPresent = otherFormulaSourceHostCountWithinOwner !== null && otherFormulaSourceHostCountWithinOwner > 0
  const otherFormulaUnknown = otherFormulaSourceHostCountWithinOwner === null

  const allowed = sourceHostContainedByOwner
    && previewHostContainedByOwner
    && nativeOutputContainedByOwner
    && nativeOutputCountWithinOwner === 1
    && !otherFormulaPresent

  emitRuntimeAudit('FORMULA-COMPOSITE-VISUAL-OWNER-FORENSIC', {
    sourceHostPath: formulaHost ? `${formulaHost.tagName}.${(formulaHost.className || '').slice(0, 40)}` : null,
    previewHostPath: previewHost ? `${previewHost.tagName}.${(previewHost.className || '').slice(0, 40)}` : null,
    mjxPath: nativeMjxOutput ? `${nativeMjxOutput.tagName}.${(nativeMjxOutput.className || '').slice(0, 40)}` : null,
    nearestCommonAncestor: compositeOwner ? `${compositeOwner.tagName}.${(compositeOwner.className || '').slice(0, 40)}` : null,
    commonAncestorTag: compositeOwner?.tagName ?? null,
    commonAncestorClass: (compositeOwner?.className || '').slice(0, 80),
    runtimeMarker: 'FORMULA-ATOMIC-TRANSACTION-RENDER-PROJECTION-V2.5.7-R5.4.3.9',
  })

  emitRuntimeAudit('FORMULA-COMPOSITE-VISUAL-OWNER-AUTHORITY', {
    stableFormulaIdentity: null,
    formulaIndex: null,
    sourceHostToken: null,
    sourceHostClass: (formulaHost.className || '').slice(0, 80),
    compositeOwnerToken: null,
    compositeOwnerClass: (compositeOwner?.className || '').slice(0, 80),
    previewHostToken: null,
    previewHostClass: (previewHost?.className || '').slice(0, 80),
    nativeOutputToken: null,
    nativeOutputNodeName: nativeMjxOutput?.nodeName ?? null,
    sourceHostContainedByOwner,
    previewHostContainedByOwner,
    nativeOutputContainedByOwner,
    nativeOutputCountWithinOwner,
    otherFormulaSourceHostCountWithinOwner,
    decision: allowed ? 'PASS' : 'FAIL',
    reason: allowed ? null
      : (!sourceHostContainedByOwner ? 'SOURCE_HOST_OUTSIDE_OWNER'
        : (!previewHostContainedByOwner ? 'PREVIEW_HOST_OUTSIDE_OWNER'
          : (!nativeOutputContainedByOwner ? 'NATIVE_OUTPUT_OUTSIDE_OWNER'
            : nativeOutputCountWithinOwner !== 1 ? 'EXPECTED_EXACTLY_ONE_NATIVE_OUTPUT'
              : otherFormulaPresent ? 'OTHER_FORMULA_HOST_WITHIN_OWNER'
                : otherFormulaUnknown ? 'COMPOSITE_OWNER_AMBIGUOUS'
                  : 'UNKNOWN_FAILURE'))),
    runtimeMarker: 'FORMULA-ATOMIC-TRANSACTION-RENDER-PROJECTION-V2.5.7-R5.4.3.9',
  })

  return {
    sourceHost: formulaHost,
    compositeOwner,
    previewHost,
    nativeMjxOutput,
    sourceHostContainedByOwner,
    previewHostContainedByOwner,
    nativeOutputContainedByOwner,
    nativeOutputCountWithinOwner,
    otherFormulaSourceHostCountWithinOwner,
    decision: allowed ? 'PASS' : 'FAIL',
    reason: allowed ? null : 'COMPOSITE_OWNER_FAILED',
  }
}

// ── Formula Projection Native Apply ─────────────────────────────────────────

export interface FormulaProjectionNativeApplyInput {
  stableFormulaIdentity: number
  formulaIndex: number
  formulaHost: HTMLElement
  oldNativeMjx: HTMLElement | null
  newFulfillmentNode: HTMLElement | null
  editorRoot: HTMLElement | null
  desiredTag: string
}

export interface FormulaProjectionNativeApplyResult {
  slotCheckPassed: boolean
  compositeOwnerResolved: boolean
  replacementAttempted: boolean
  replacementSucceeded: boolean
  visibleTagBefore: string | null
  visibleTagAfter: string | null
  expectedTagMatched: boolean
  decision: string
  reason: string | null
}

export function applyFormulaProjectionNative(input: FormulaProjectionNativeApplyInput): FormulaProjectionNativeApplyResult {
  const { stableFormulaIdentity, formulaIndex, formulaHost, oldNativeMjx, newFulfillmentNode, editorRoot, desiredTag } = input

  // 1. Resolve composite visual owner
  const compositeOwner = resolveFormulaCompositeVisualOwner(formulaHost, editorRoot)

  // 2. Resolve the old native MJX output
  const oldMjx = oldNativeMjx ?? compositeOwner.nativeMjxOutput

  // 3. Check native slot ownership
  const slotCheck = checkNativeSlotOwnership({
    formulaHost,
    targetNode: oldMjx,
  })

  const compositeOwnerResolved = compositeOwner.decision === 'PASS'
  const slotCheckPassed = slotCheck.allowed && compositeOwnerResolved
  const visibleTagBefore = oldMjx ? readVisibleFormulaTag(formulaHost, desiredTag).visibleTagText : null

  let replacementAttempted = false
  let replacementSucceeded = false
  let visibleTagAfter: string | null = null
  let expectedTagMatched = false

  if (slotCheckPassed && newFulfillmentNode && oldMjx && oldMjx.parentNode) {
    replacementAttempted = true
    const visualBefore = captureVisualIntegritySnapshot(formulaHost, editorRoot)
    oldMjx.replaceWith(newFulfillmentNode)
    const visualAfter = verifyVisualIntegrity(formulaHost, editorRoot, visualBefore)

    if (visualAfter.decision === 'PASS') {
      replacementSucceeded = true
      visibleTagAfter = readVisibleFormulaTag(formulaHost, desiredTag).visibleTagText
      expectedTagMatched = visibleTagAfter === desiredTag
    } else {
      // Rollback
      const newMjx = formulaHost.querySelector('mjx-container')
      if (newMjx && newMjx.parentNode) {
        newMjx.replaceWith(oldMjx)
      }
    }
  }

  emitRuntimeAudit('FORMULA-PROJECTION-NATIVE-APPLY', {
    stableFormulaIdentity,
    formulaIndex,
    compositeOwnerResolved,
    nativeOldNodeResolved: !!oldMjx,
    newFulfillmentResolved: !!newFulfillmentNode,
    replacementAttempted,
    replacementSucceeded,
    oldNodeToken: null,
    newNodeToken: null,
    visibleTagBefore,
    visibleTagAfter,
    desiredTag,
    expectedTagMatched,
    decision: replacementSucceeded && expectedTagMatched ? 'PASS' : 'FAIL',
    reason: replacementSucceeded && expectedTagMatched ? null
      : (!slotCheckPassed ? 'SLOT_OWNERSHIP_FAILED'
        : !replacementAttempted ? 'REPLACEMENT_NOT_ATTEMPTED'
          : !replacementSucceeded ? 'VISUAL_INTEGRITY_FAILED'
            : !expectedTagMatched ? 'VISIBLE_TAG_MISMATCH' : 'UNKNOWN'),
    runtimeMarker: 'FORMULA-ATOMIC-TRANSACTION-RENDER-PROJECTION-V2.5.7-R5.4.3.9',
  })

  return {
    slotCheckPassed,
    compositeOwnerResolved,
    replacementAttempted,
    replacementSucceeded,
    visibleTagBefore,
    visibleTagAfter,
    expectedTagMatched,
    decision: replacementSucceeded && expectedTagMatched ? 'PASS' : 'FAIL',
    reason: replacementSucceeded && expectedTagMatched ? null : 'APPLY_FAILED',
  }
}
