/**
 * Formula Projection Controller (Phase 7R.3 / 7R.3.2 / 7R.3.3)
 *
 * Single responsibility: FORMULA PROJECTION ARBITRATION.
 *
 * It decides WHICH projection authority renders the visible Formula number:
 *
 *   Canonical logical Formula
 *         ↓
 *   Semantic Formula Plan (computed by formula-semantic-planner)
 *         ↓
 *   FormulaProjectionController (arbitrator)
 *         ↓
 *   ONE projection authority
 *
 * It does NOT own heading semantics, chapter/section ordinal, Formula ordinal
 * counting, or Formula target discovery.
 *
 * Authorities:
 *   - 'typora-native'                  → Typora owns projection (OFF/AMS/ALL untouched)
 *   - 'defer'                          → semantic prerequisites not ready, writes=0
 *   - 'inkchapter-native-transient'    → InkChapter semantic number injected as a
 *                                        transient MathJax `\tag{...}` in the SAME
 *                                        native render pass (one visible number)
 *   - 'explicit-user-tag-preserved'    → source contains `\tag{X}`; preserve it,
 *                                        never overwrite, never double-project
 *
 * Phase 7R.3.2 lifecycle:
 *   - TRANSIENT PLAN creation must be READY BEFORE the MathJax renderer exists.
 *     `rendererReady=false` never blocks plan creation; it only gates
 *     POST-RENDER commit / visible verification.
 *   - The MathJax hook is a SINGLE STABLE WRAPPER with a LIVE context provider.
 *   - Snapshot REVISION is provenance only; revision drift on an identical
 *     plan is accepted. Document mismatch is NEVER relaxed.
 *
 * Phase 7R.3.3 dynamic reprojection:
 *   - Each Formula plan has an explicit PROJECTION SIGNATURE
 *     (documentKey + host + sourceHash + rawNumber + authority + formulaMode).
 *   - All execution evidence (injected / committed / renderRequested /
 *     recoveryAttempt) is scoped to the EXACT current signature. A changed
 *     signature invalidates old evidence and grants ONE fresh targeted render.
 *   - Old/new plan diff produces an AFFECTED SET; only affected hosts with an
 *     existing renderer are re-rendered (differential, event-driven).
 */

import { emitRuntimeAudit } from '../runtime/forensic-log-sink'

export type TyporaFormulaAutoNumberingPolicy = 'off' | 'ams' | 'all' | 'unknown'

export type FormulaProjectionAuthority =
  | 'typora-native'
  | 'inkchapter-native-transient'
  | 'defer'
  | 'explicit-user-tag-preserved'

export interface FormulaProjectionContext {
  formulaMode: 'typora-native' | 'inkchapter'
  typoraAutoNumberingPolicy: TyporaFormulaAutoNumberingPolicy
  /** Heading snapshot exists and matches the active document. */
  snapshotReady: boolean
  documentCoherent: boolean
  /** POST-RENDER readiness — does NOT gate plan creation (Phase 7R.3.2). */
  rendererReady: boolean
}

export interface FormulaNativeRenderPlan {
  documentKey: string
  revision: number
  sourceHash: string
  /** Semantic raw number WITHOUT wrapper, e.g. `1.1-1` (used inside `\tag{...}`). */
  rawNumber: string
  /** Semantic rendered number WITH wrapper, e.g. `(1.1-1)` (diagnostics). */
  renderedNumber: string
  /** Diagnostic runtime key (`formula:${ordinal}`) — NOT a stable identity. */
  formulaRuntimeKey: string
  authority: 'inkchapter-native-transient'
  formulaMode: 'inkchapter'
}

/** Phase 7R.3.3: canonical Formula projection signature (semantic, no revision). */
export interface FormulaProjectionSignature {
  documentKey: string
  host: HTMLElement
  sourceHash: string
  rawNumber: string
  authority: FormulaProjectionAuthority
  formulaMode: 'typora-native' | 'inkchapter'
}

export type FormulaAffectedReason =
  | 'UNCHANGED'
  | 'NEW_FORMULA'
  | 'SOURCE_CHANGED'
  | 'SEMANTIC_NUMBER_CHANGED'
  | 'PROJECTION_AUTHORITY_CHANGED'
  | 'FORMULA_MODE_CHANGED'
  | 'DOCUMENT_CHANGED'
  | 'REMOVED_FORMULA'

/**
 * Per-host execution state, STRICTLY scoped to the current projection signature
 * (Phase 7R.3.3-B). Old-signature evidence never leaks into a new signature.
 */
export interface HostProjectionState {
  currentPlannedSignatureHash: string
  lastInjectedSignatureHash: string | null
  lastCommittedSignatureHash: string | null
  lastRenderRequestedSignatureHash: string | null
  lastLookupDecision: FormulaTransientPlanLookupDecision | undefined
  executionState: FormulaProjectionExecutionState
  recoveryAttempts: Map<string, number>
}

/**
 * Per-host transient-render execution state machine.
 * Prevents plan→rerender→mutation→rerender loops.
 */
export type FormulaProjectionExecutionState =
  | 'idle'
  | 'plan-ready'
  | 'render-requested'
  | 'rendering'
  | 'committed'

export type FormulaTransientPlanLookupDecision =
  | 'MATCHED'
  | 'REVISION_DRIFT_SEMANTIC_EQUIVALENT_ACCEPTED'
  | 'REVISION_MISMATCH_SEMANTIC_CHANGED'
  | 'NO_ACTIVE_PLAN_SET'
  | 'PLAN_SET_INCOMPLETE'
  | 'NO_SOURCE_MATCH_IN_COMPLETE_PLAN_SET'
  | 'AMBIGUOUS_SOURCE_MATCH'
  | 'HOST_DISCONNECTED'
  | 'DOCUMENT_MISMATCH'
  | 'EXPLICIT_USER_TAG_PRESERVED'

export type FormulaVerifyDecision =
  | 'SEMANTIC_VISIBLE_VERIFIED'
  | 'DUPLICATE'
  | 'TRANSIENT_OUTPUT_NOT_COMMITTED'
  | 'TRANSIENT_PLAN_PENDING'
  | 'TRANSIENT_PLAN_NOT_CONSUMED'
  | 'NO_CUSTOM_OVERLAY_ONLY'

export interface FormulaVerifyInput {
  planExists: boolean
  injected: boolean
  committedForCurrentSignature: boolean
  lookupDecision: FormulaTransientPlanLookupDecision | undefined
  semanticCommitted: boolean
  sequentialCommitted: boolean
  customDecorationCount: number
}

/**
 * Phase 7R.3.1-A / 7R.3.3-F verifier — the ONLY path to SEMANTIC_VISIBLE_VERIFIED.
 * `customDecorationCount=0` alone never implies the semantic number is visible;
 * `semanticCommitted` must already be an EXACT tag-token match against the
 * CURRENT planned signature (never substring, never a stale commit).
 */
export function classifyFormulaProjectionVerify(input: FormulaVerifyInput): FormulaVerifyDecision {
  const { planExists, injected, committedForCurrentSignature, lookupDecision, semanticCommitted, sequentialCommitted, customDecorationCount } = input
  if (planExists && injected && committedForCurrentSignature && semanticCommitted && customDecorationCount === 0 && !sequentialCommitted) {
    return 'SEMANTIC_VISIBLE_VERIFIED'
  }
  if (planExists && injected && semanticCommitted && sequentialCommitted) return 'DUPLICATE'
  if (planExists && injected && !semanticCommitted) return 'TRANSIENT_OUTPUT_NOT_COMMITTED'
  if (planExists && !injected) {
    return lookupDecision === 'MATCHED' || lookupDecision === 'REVISION_DRIFT_SEMANTIC_EQUIVALENT_ACCEPTED'
      ? 'TRANSIENT_PLAN_PENDING'
      : 'TRANSIENT_PLAN_NOT_CONSUMED'
  }
  return 'NO_CUSTOM_OVERLAY_ONLY'
}

export interface FormulaRenderInputDecision {
  /** The TeX string to hand to MathJax (unchanged when not injected). */
  tex: string
  injected: boolean
  authority: FormulaProjectionAuthority
  sourceHash: string
}

/** A source-authored explicit `\tag{...}` — must be preserved, never overwritten. */
export function sourceHasExplicitUserTag(tex: string): boolean {
  return /(^|[^\\])\\tag\s*\{/.test(tex)
}

/**
 * Scan the Markdown source for display-math `$$...$$` blocks in document order.
 * Used ONLY to obtain the render-input correlation hash per canonical Formula
 * host (document order ↔ canonical target order). It is NOT semantic authority.
 */
export function scanDisplayMathSources(markdown: string): string[] {
  const sources: string[] = []
  const re = /\$\$([\s\S]*?)\$\$/g
  let m: RegExpExecArray | null
  while ((m = re.exec(markdown ?? '')) !== null) {
    sources.push(m[1])
  }
  return sources
}

/** Deterministic, bounded source hash used only for render-call↔host correlation. */
export function hashFormulaSource(tex: string): string {
  let h = 5381
  const s = (tex ?? '').replace(/\s+/g, ' ').trim()
  for (let i = 0; i < s.length; i++) {
    h = ((h << 5) + h + s.charCodeAt(i)) | 0
  }
  return `h${(h >>> 0).toString(36)}`
}

/** Normalize the Typora preference value into a typed projection policy. */
export function normalizeTyporaAutoNumberingPolicy(raw: string | boolean | undefined | null): TyporaFormulaAutoNumberingPolicy {
  if (raw === true) return 'all'
  if (raw === 'all') return 'all'
  if (raw === 'ams') return 'ams'
  if (raw === false || raw === 'false' || raw === 'none' || raw === '0' || raw === 'null' || raw === 'nil' || raw == null) {
    return 'off'
  }
  return 'unknown'
}

/** Bounded diagnostic hash of a projection signature (logging only). */
export function hashProjectionSignature(sig: FormulaProjectionSignature): string {
  return hashFormulaSource(`${sig.documentKey}|${sig.sourceHash}|${sig.rawNumber}|${sig.authority}|${sig.formulaMode}`)
}

/** Signature from a published plan + its host. */
export function projectionSignatureOf(host: HTMLElement, plan: FormulaNativeRenderPlan): FormulaProjectionSignature {
  return {
    documentKey: plan.documentKey,
    host,
    sourceHash: plan.sourceHash,
    rawNumber: plan.rawNumber,
    authority: plan.authority,
    formulaMode: plan.formulaMode,
  }
}

export class FormulaProjectionController {
  private plans = new WeakMap<HTMLElement, FormulaNativeRenderPlan>()
  private sourceIndex = new Map<string, Set<HTMLElement>>()
  private stateByHost = new WeakMap<HTMLElement, HostProjectionState>()
  private planGenerationValue = 0
  private expectedPlanCount = 0

  private stateOf(host: HTMLElement): HostProjectionState {
    let s = this.stateByHost.get(host)
    if (!s) {
      s = {
        currentPlannedSignatureHash: '',
        lastInjectedSignatureHash: null,
        lastCommittedSignatureHash: null,
        lastRenderRequestedSignatureHash: null,
        lastLookupDecision: undefined,
        executionState: 'idle',
        recoveryAttempts: new Map<string, number>(),
      }
      this.stateByHost.set(host, s)
    }
    return s
  }

  /**
   * Select ONE projection authority for a Formula.
   * Phase 7R.3.2: `rendererReady` does NOT gate plan creation.
   */
  arbitrate(context: FormulaProjectionContext): FormulaProjectionAuthority {
    if (context.formulaMode === 'typora-native') return 'typora-native'
    if (!context.snapshotReady || !context.documentCoherent) return 'defer'
    return 'inkchapter-native-transient'
  }

  setExpectedPlanCount(count: number): void {
    this.expectedPlanCount = count
  }

  getPlanGeneration(): number {
    return this.planGenerationValue
  }

  bumpPlanGeneration(): void {
    this.planGenerationValue++
  }

  getPlan(host: HTMLElement): FormulaNativeRenderPlan | undefined {
    return this.plans.get(host)
  }

  getPlanBySourceHash(sourceHash: string): FormulaNativeRenderPlan | undefined {
    const hosts = this.sourceIndex.get(sourceHash)
    if (!hosts || hosts.size !== 1) return undefined
    const host = hosts.values().next().value as HTMLElement
    return this.plans.get(host)
  }

  /** Current plan's projection signature hash (empty if no plan). */
  currentSignatureHash(host: HTMLElement): string {
    const plan = this.plans.get(host)
    if (!plan) return ''
    return hashProjectionSignature(projectionSignatureOf(host, plan))
  }

  /** Semantic projection signature WITHOUT snapshot revision (Phase 7R.3.3). */
  semanticProjectionSignature(host: HTMLElement): string {
    return this.currentSignatureHash(host)
  }

  // ── Signature-scoped execution evidence (Phase 7R.3.3-B) ───────────────
  getExecutionState(host: HTMLElement): FormulaProjectionExecutionState {
    return this.stateOf(host).executionState
  }

  setExecutionState(host: HTMLElement, state: FormulaProjectionExecutionState): void {
    this.stateOf(host).executionState = state
  }

  wasInjectedForCurrentSignature(host: HTMLElement): boolean {
    const s = this.stateOf(host)
    return s.lastInjectedSignatureHash !== null && s.lastInjectedSignatureHash === s.currentPlannedSignatureHash
  }

  isCommittedForCurrentSignature(host: HTMLElement): boolean {
    const s = this.stateOf(host)
    return s.lastCommittedSignatureHash !== null && s.lastCommittedSignatureHash === s.currentPlannedSignatureHash
  }

  lastLookup(host: HTMLElement): FormulaTransientPlanLookupDecision | undefined {
    return this.stateOf(host).lastLookupDecision
  }

  lastCommittedSignatureHash(host: HTMLElement): string | null {
    return this.stateOf(host).lastCommittedSignatureHash
  }

  lastRenderRequestedSignatureHash(host: HTMLElement): string | null {
    return this.stateOf(host).lastRenderRequestedSignatureHash
  }

  recoveryAttemptCount(host: HTMLElement): number {
    const sig = this.currentSignatureHash(host)
    return this.stateOf(host).recoveryAttempts.get(sig) ?? 0
  }

  /**
   * One-shot controlled-recovery budget PER PROJECTION SIGNATURE.
   * A changed signature resets the budget (Phase 7R.3.3-D).
   */
  tryReserveRecoveryRender(host: HTMLElement): boolean {
    const sig = this.currentSignatureHash(host)
    if (!sig) return false
    const s = this.stateOf(host)
    const count = s.recoveryAttempts.get(sig) ?? 0
    if (count >= 1) return false
    s.recoveryAttempts.set(sig, count + 1)
    return true
  }

  /**
   * Phase 7R.3.3-C: replace a host's plan, diffing the OLD vs NEW projection
   * signature. Returns the affected classification.
   *   - same signature → UNCHANGED, execution state preserved.
   *   - changed signature → old execution evidence invalidated, state=plan-ready.
   */
  applyProjectionPlan(host: HTMLElement, newPlan: FormulaNativeRenderPlan, reason?: FormulaAffectedReason): { affected: boolean; reason: FormulaAffectedReason } {
    const old = this.plans.get(host)
    const oldSig = old ? hashProjectionSignature(projectionSignatureOf(host, old)) : ''
    const newSig = hashProjectionSignature(projectionSignatureOf(host, newPlan))
    const s = this.stateOf(host)

    if (old && oldSig === newSig) {
      // Same semantic signature — refresh the plan object (revision provenance)
      // but preserve all execution evidence. NO_OP per Phase 7R.3.3-B §8.
      this.plans.set(host, newPlan)
      s.currentPlannedSignatureHash = newSig
      return { affected: false, reason: 'UNCHANGED' }
    }

    const changeReason: FormulaAffectedReason = reason ?? classifyPlanChange(old, newPlan)
    // Explicit state invalidation for the NEW signature (Phase 7R.3.3-B §7).
    const oldState = s.executionState
    s.lastInjectedSignatureHash = null
    s.lastCommittedSignatureHash = null
    s.lastRenderRequestedSignatureHash = null
    s.lastLookupDecision = undefined
    s.executionState = 'plan-ready'
    // Recovery budget is per signature; the NEW signature starts at 0.
    this.setPlan(host, newPlan)
    s.currentPlannedSignatureHash = newSig
    emitRuntimeAudit('FORMULA-PROJECTION-STATE-INVALIDATE', {
      documentKey: newPlan.documentKey,
      formulaRuntimeKey: newPlan.formulaRuntimeKey,
      oldSignatureHash: oldSig,
      newSignatureHash: newSig,
      oldRawNumber: old?.rawNumber ?? null,
      newRawNumber: newPlan.rawNumber,
      oldExecutionState: oldState,
      newExecutionState: 'plan-ready',
      resetInjected: true,
      resetCommitted: true,
      resetRenderRequested: true,
      resetRecoveryBudget: true,
      reason: changeReason,
    })
    emitRuntimeAudit('FORMULA-PROJECTION-PLAN-DIFF', {
      documentKey: newPlan.documentKey,
      formulaRuntimeKey: newPlan.formulaRuntimeKey,
      oldSourceHash: old?.sourceHash ?? null,
      newSourceHash: newPlan.sourceHash,
      oldRawNumber: old?.rawNumber ?? null,
      newRawNumber: newPlan.rawNumber,
      oldSignatureHash: oldSig,
      newSignatureHash: newSig,
      oldCommittedSignatureHash: old ? s.lastCommittedSignatureHash : null,
      newCurrentSignatureHash: newSig,
      affected: true,
      reason: changeReason,
    })
    return { affected: true, reason: changeReason }
  }

  /** Clear all plans + state (mode switch, document switch, dispose). */
  clearAll(): void {
    this.plans = new WeakMap<HTMLElement, FormulaNativeRenderPlan>()
    this.sourceIndex = new Map<string, Set<HTMLElement>>()
    this.stateByHost = new WeakMap<HTMLElement, HostProjectionState>()
    this.expectedPlanCount = 0
  }

  /** Bind (or refresh) a plan for a host (no diff; used at document bootstrap). */
  setPlan(host: HTMLElement, plan: FormulaNativeRenderPlan): void {
    this.plans.set(host, plan)
    let hosts = this.sourceIndex.get(plan.sourceHash)
    if (!hosts) {
      hosts = new Set()
      this.sourceIndex.set(plan.sourceHash, hosts)
    }
    hosts.add(host)
    this.stateOf(host).currentPlannedSignatureHash = hashProjectionSignature(projectionSignatureOf(host, plan))
  }

  /** Remove a host's plan (document switch / mode change cleanup). */
  clearPlan(host: HTMLElement): void {
    const plan = this.plans.get(host)
    if (plan) {
      const hosts = this.sourceIndex.get(plan.sourceHash)
      if (hosts) {
        hosts.delete(host)
        if (hosts.size === 0) this.sourceIndex.delete(plan.sourceHash)
      }
    }
    this.plans.delete(host)
  }

  /**
   * Prepare the TRANSIENT render input for one MathJax call.
   * LIVE document context must be passed on every call.
   */
  prepareTransientRenderInput(
    tex: string,
    documentKey: string,
    liveRevision: number,
  ): FormulaRenderInputDecision {
    const sourceHash = hashFormulaSource(tex)
    const inputHasExplicitTag = sourceHasExplicitUserTag(tex)
    const hosts = this.sourceIndex.get(sourceHash)
    const activePlanCount = this.sourceIndex.size

    const emitLookup = (host: HTMLElement | null, decision: FormulaTransientPlanLookupDecision) => {
      if (host) this.stateOf(host).lastLookupDecision = decision
      emitRuntimeAudit('FORMULA-TRANSIENT-PLAN-LOOKUP', {
        documentKey,
        activeRevision: liveRevision,
        inputHash: sourceHash,
        activePlanCount,
        expectedPlanCount: this.expectedPlanCount,
        planSetComplete: activePlanCount >= this.expectedPlanCount && this.expectedPlanCount > 0,
        sourceHashMatchCount: hosts ? hosts.size : 0,
        matchedFormulaRuntimeKey: host && this.plans.get(host) ? this.plans.get(host)!.formulaRuntimeKey : null,
        matchedHostConnected: host ? host.isConnected : null,
        inputHasExplicitTag,
        decision,
      })
    }

    if (!hosts || hosts.size === 0) {
      if (activePlanCount === 0) {
        emitLookup(null, 'NO_ACTIVE_PLAN_SET')
      } else if (activePlanCount < this.expectedPlanCount) {
        emitLookup(null, 'PLAN_SET_INCOMPLETE')
      } else {
        emitLookup(null, 'NO_SOURCE_MATCH_IN_COMPLETE_PLAN_SET')
      }
      return { tex, injected: false, authority: 'defer', sourceHash }
    }
    if (hosts.size > 1) {
      emitLookup(null, 'AMBIGUOUS_SOURCE_MATCH')
      return { tex, injected: false, authority: 'defer', sourceHash }
    }
    const host = hosts.values().next().value as HTMLElement
    const plan = this.plans.get(host)
    if (!plan) {
      emitLookup(host, 'NO_ACTIVE_PLAN_SET')
      return { tex, injected: false, authority: 'defer', sourceHash }
    }
    if (!host.isConnected) {
      emitLookup(host, 'HOST_DISCONNECTED')
      this.clearPlan(host)
      return { tex, injected: false, authority: 'defer', sourceHash }
    }
    if (plan.documentKey !== documentKey) {
      emitLookup(host, 'DOCUMENT_MISMATCH')
      this.clearPlan(host)
      return { tex, injected: false, authority: 'defer', sourceHash }
    }
    if (inputHasExplicitTag) {
      emitLookup(host, 'EXPLICIT_USER_TAG_PRESERVED')
      return { tex, injected: false, authority: 'explicit-user-tag-preserved', sourceHash }
    }

    // Phase 7R.3.2-C: revision drift on an identical plan is ACCEPTED.
    const revisionDrift = plan.revision !== liveRevision
    const decision: FormulaTransientPlanLookupDecision = revisionDrift
      ? 'REVISION_DRIFT_SEMANTIC_EQUIVALENT_ACCEPTED'
      : 'MATCHED'

    const injectedTex = `${tex}\\tag{${plan.rawNumber}}`
    // Injection evidence is scoped to the CURRENT signature.
    const sig = hashProjectionSignature(projectionSignatureOf(host, plan))
    const s = this.stateOf(host)
    s.lastInjectedSignatureHash = sig
    s.executionState = 'rendering'
    emitLookup(host, decision)
    return { tex: injectedTex, injected: true, authority: 'inkchapter-native-transient', sourceHash }
  }

  /** Mark the CURRENT signature as committed (visible verification passed). */
  markCommitted(host: HTMLElement): void {
    const s = this.stateOf(host)
    s.lastCommittedSignatureHash = s.currentPlannedSignatureHash
    s.executionState = 'committed'
  }

  /** Record a targeted render request for the CURRENT signature. */
  markRenderRequested(host: HTMLElement): void {
    const s = this.stateOf(host)
    s.lastRenderRequestedSignatureHash = s.currentPlannedSignatureHash
  }

  /** Diagnostic inventory (bounded). */
  inventory(): { planCount: number; uniqueSourceHashCount: number; expectedPlanCount: number } {
    return {
      planCount: this.sourceIndex.size,
      uniqueSourceHashCount: this.sourceIndex.size,
      expectedPlanCount: this.expectedPlanCount,
    }
  }
}

/** Classify the OLD→NEW plan change reason (Phase 7R.3.3-C §10). */
export function classifyPlanChange(old: FormulaNativeRenderPlan | undefined, next: FormulaNativeRenderPlan): FormulaAffectedReason {
  if (!old) return 'NEW_FORMULA'
  if (old.documentKey !== next.documentKey) return 'DOCUMENT_CHANGED'
  if (old.formulaMode !== next.formulaMode) return 'FORMULA_MODE_CHANGED'
  if (old.authority !== next.authority) return 'PROJECTION_AUTHORITY_CHANGED'
  if (old.rawNumber !== next.rawNumber) return 'SEMANTIC_NUMBER_CHANGED'
  if (old.sourceHash !== next.sourceHash) return 'SOURCE_CHANGED'
  return 'UNCHANGED'
}
