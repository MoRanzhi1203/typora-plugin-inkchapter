/**
 * Formula Projection Controller (Phase 7R.3 / 7R.3.2 / 7R.3.3 / 7R.3.6)
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
 *     recoveryAttempt) is scoped to the EXACT current signature.
 *
 * Phase 7R.3.6 activation model:
 *   - The semantic projection signature answers "WHAT should be visible".
 *   - A separate per-host ACTIVATION answers "WHICH execution transaction is
 *     current". A changed signature ALWAYS creates a NEW activationId — even if
 *     that signature appeared historically (A→B→A gives activation 3).
 *   - Rerender budget is ONE-SHOT PER ACTIVATION, never per historical signature.
 *     Historical signature attempts remain DIAGNOSTIC ONLY (non-gating).
 *   - Transition lineage (previousActivationId / previousSignatureHash /
 *     previousRawNumber) is captured BEFORE the old state is replaced.
 *   - Durable commit state: lastInjected/lastCommitted ActivationId + SignatureHash
 *     + RawNumber + PlanSetEpoch are persisted on the CURRENT activation.
 *   - Stale async MathJax output (old activation resolves after a heading change)
 *     is STALE_ACTIVATION_COMMIT_IGNORED and never overwrites current authority.
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
 * Phase 7R.3.6: per-host Formula EXECUTION activation.
 *
 * Signature answers WHAT should be visible; activation answers WHICH execution
 * transaction is current. A new activationId is minted on EVERY signature
 * change (historical signatures never gate a new activation).
 */
export interface FormulaProjectionActivation {
  activationId: number
  signatureHash: string
  previousSignatureHash: string | null
  documentKey: string
  sourceHash: string
  rawNumber: string
  state: FormulaProjectionExecutionState
  /** ONE-SHOT rerender budget per activation (Phase 7R.3.6-D). */
  rerenderAttemptCount: number
  injected: boolean
  committed: boolean
  planSetEpoch: number
  headingSnapshotRevision: number
  editorStructureEpoch: number
  // ── Durable commit state (Phase 7R.3.6-L) ───────────────────────────
  lastInjectedActivationId: number | null
  lastInjectedSignatureHash: string | null
  lastCommittedActivationId: number | null
  lastCommittedSignatureHash: string | null
  lastCommittedRawNumber: string | null
  lastCommittedPlanSetEpoch: number | null
  lastRenderRequestedActivationId: number | null
  lastRenderRequestedSignatureHash: string | null
}

/** Phase 7R.3.6-E: transition lineage captured BEFORE replacing old state. */
export interface FormulaProjectionTransition {
  formulaHost: HTMLElement
  previousActivationId: number | null
  previousSignatureHash: string | null
  previousRawNumber: string | null
  currentActivationId: number
  currentSignatureHash: string
  currentRawNumber: string
  reason:
    | 'NEW_FORMULA'
    | 'SEMANTIC_NUMBER_CHANGED'
    | 'SOURCE_CHANGED'
    | 'MODE_CHANGED'
    | 'AUTHORITY_CHANGED'
    | 'DOCUMENT_CHANGED'
}

/**
 * Per-host execution state, activation-scoped (Phase 7R.3.6).
 * Old-activation evidence never leaks into a new activation.
 */
export interface HostProjectionState {
  currentPlannedSignatureHash: string
  activation: FormulaProjectionActivation | null
  lastLookupDecision: FormulaTransientPlanLookupDecision | undefined
  executionState: FormulaProjectionExecutionState
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
  | 'STALE_ACTIVATION_LOOKUP'

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

/** One-shot controlled rerender budget per ACTIVATION (Phase 7R.3.6-D §12). */
export const MAX_CONTROLLED_RERENDER_PER_ACTIVATION = 1

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
  /** Phase 7R.3.6-K: activation-aware execution identity carried end-to-end. */
  planSetEpoch?: number
  activationId?: number | null
  signatureHash?: string
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

/** Map a plan-change classification onto a transition reason (Phase 7R.3.6-E §15). */
export function transitionReasonOf(changeReason: FormulaAffectedReason): FormulaProjectionTransition['reason'] {
  switch (changeReason) {
    case 'NEW_FORMULA': return 'NEW_FORMULA'
    case 'SOURCE_CHANGED': return 'SOURCE_CHANGED'
    case 'SEMANTIC_NUMBER_CHANGED': return 'SEMANTIC_NUMBER_CHANGED'
    case 'PROJECTION_AUTHORITY_CHANGED': return 'AUTHORITY_CHANGED'
    case 'FORMULA_MODE_CHANGED': return 'MODE_CHANGED'
    case 'DOCUMENT_CHANGED': return 'DOCUMENT_CHANGED'
    default: return 'SEMANTIC_NUMBER_CHANGED'
  }
}

export class FormulaProjectionController {
  private plans = new WeakMap<HTMLElement, FormulaNativeRenderPlan>()
  private sourceIndex = new Map<string, Set<HTMLElement>>()
  private stateByHost = new WeakMap<HTMLElement, HostProjectionState>()
  private planGenerationValue = 0
  private expectedPlanCount = 0
  private activationIdCounter = 0
  private planSetEpochValue = 0
  /** Phase 7R.3.6 §11: historical signature attempt counts — DIAGNOSTIC ONLY. */
  private historicalSignatureAttempts = new Map<string, number>()
  private staleActivationCommitIgnoredCount = 0
  private staleActivationLookupCount = 0
  private adoptedExistingSemanticOutputCount = 0

  private stateOf(host: HTMLElement): HostProjectionState {
    let s = this.stateByHost.get(host)
    if (!s) {
      s = {
        currentPlannedSignatureHash: '',
        activation: null,
        lastLookupDecision: undefined,
        executionState: 'idle',
      }
      this.stateByHost.set(host, s)
    }
    return s
  }

  private nextActivationId(): number {
    return ++this.activationIdCounter
  }

  // ── Plan-set epoch (Phase 7R.3.6-I §28) ──────────────────────────────
  getPlanSetEpoch(): number {
    return this.planSetEpochValue
  }

  /** Increment ONLY when a COMPLETE candidate is atomically published. */
  beginPlanSetEpoch(): number {
    this.planSetEpochValue++
    return this.planSetEpochValue
  }

  // ── Activation accessors ─────────────────────────────────────────────

  /** Current activation for a host (null before the first plan publish). */
  getCurrentActivation(host: HTMLElement): FormulaProjectionActivation | null {
    return this.stateOf(host).activation
  }

  getActivationId(host: HTMLElement): number | null {
    return this.stateOf(host).activation?.activationId ?? null
  }

  /** Historical attempt count for a signature — diagnostics only, never gating. */
  getHistoricalSignatureAttemptCount(signatureHash: string): number {
    return this.historicalSignatureAttempts.get(signatureHash) ?? 0
  }

  /**
   * Phase 7R.3.6 §35: check whether an async output transaction is still the
   * CURRENT activation for its host. Used by the MathJax hook's `.then()`.
   */
  isCurrentActivation(host: HTMLElement, activationId: number, planSetEpoch: number): boolean {
    const act = this.stateOf(host).activation
    if (!act) return false
    return act.activationId === activationId && act.planSetEpoch === planSetEpoch
  }

  /** Resolve host + current activation by source hash (hook async guard). */
  getHostBySourceHash(sourceHash: string): { host: HTMLElement; activation: FormulaProjectionActivation | null } | null {
    const hosts = this.sourceIndex.get(sourceHash)
    if (!hosts || hosts.size !== 1) return null
    const host = hosts.values().next().value as HTMLElement
    return { host, activation: this.stateOf(host).activation }
  }

  markStaleActivationCommitIgnored(documentKey: string, formulaRuntimeKey: string | null, reason: string): void {
    this.staleActivationCommitIgnoredCount++
    emitRuntimeAudit('FORMULA-ASYNC-COMMIT-GUARD', {
      documentKey,
      formulaRuntimeKey: formulaRuntimeKey ?? null,
      decision: 'STALE_ACTIVATION_COMMIT_IGNORED',
      reason,
      staleActivationCommitIgnoredCount: this.staleActivationCommitIgnoredCount,
    })
  }

  markStaleActivationLookup(documentKey: string, formulaRuntimeKey: string | null): void {
    this.staleActivationLookupCount++
    emitRuntimeAudit('FORMULA-ASYNC-COMMIT-GUARD', {
      documentKey,
      formulaRuntimeKey: formulaRuntimeKey ?? null,
      decision: 'STALE_ACTIVATION_LOOKUP',
      staleActivationLookupCount: this.staleActivationLookupCount,
    })
  }

  getStaleActivationCounters(): { staleActivationCommitIgnoredCount: number; staleActivationLookupCount: number; adoptedExistingSemanticOutputCount: number } {
    return {
      staleActivationCommitIgnoredCount: this.staleActivationCommitIgnoredCount,
      staleActivationLookupCount: this.staleActivationLookupCount,
      adoptedExistingSemanticOutputCount: this.adoptedExistingSemanticOutputCount,
    }
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

  // ── Activation-scoped execution evidence (Phase 7R.3.6) ──────────────
  getExecutionState(host: HTMLElement): FormulaProjectionExecutionState {
    return this.stateOf(host).executionState
  }

  setExecutionState(host: HTMLElement, state: FormulaProjectionExecutionState): void {
    const s = this.stateOf(host)
    s.executionState = state
    if (s.activation) s.activation.state = state
  }

  wasInjectedForCurrentSignature(host: HTMLElement): boolean {
    const act = this.stateOf(host).activation
    return act !== null && act.injected && act.lastInjectedActivationId === act.activationId
  }

  isCommittedForCurrentSignature(host: HTMLElement): boolean {
    const act = this.stateOf(host).activation
    return act !== null && act.committed && act.lastCommittedActivationId === act.activationId
  }

  lastLookup(host: HTMLElement): FormulaTransientPlanLookupDecision | undefined {
    return this.stateOf(host).lastLookupDecision
  }

  lastCommittedSignatureHash(host: HTMLElement): string | null {
    return this.stateOf(host).activation?.lastCommittedSignatureHash ?? null
  }

  lastRenderRequestedSignatureHash(host: HTMLElement): string | null {
    return this.stateOf(host).activation?.lastRenderRequestedSignatureHash ?? null
  }

  recoveryAttemptCount(host: HTMLElement): number {
    return this.stateOf(host).activation?.rerenderAttemptCount ?? 0
  }

  /** Durable commit record for the current activation (Phase 7R.3.6-L). */
  commitState(host: HTMLElement): {
    currentActivationId: number | null
    currentSignatureHash: string
    lastCommittedActivationId: number | null
    lastCommittedSignatureHash: string | null
    lastCommittedRawNumber: string | null
    lastCommittedPlanSetEpoch: number | null
    planSetEpoch: number
  } {
    const s = this.stateOf(host)
    const act = s.activation
    return {
      currentActivationId: act?.activationId ?? null,
      currentSignatureHash: s.currentPlannedSignatureHash,
      lastCommittedActivationId: act?.lastCommittedActivationId ?? null,
      lastCommittedSignatureHash: act?.lastCommittedSignatureHash ?? null,
      lastCommittedRawNumber: act?.lastCommittedRawNumber ?? null,
      lastCommittedPlanSetEpoch: act?.lastCommittedPlanSetEpoch ?? null,
      planSetEpoch: act?.planSetEpoch ?? this.planSetEpochValue,
    }
  }

  /**
   * Phase 7R.3.6-D: one-shot controlled-recovery budget PER ACTIVATION.
   * A NEW activation starts at 0. Historical signature attempts are NOT gating.
   * The attempt counter increments ONLY when a request is allowed.
   */
  tryReserveRecoveryRender(host: HTMLElement): boolean {
    const s = this.stateOf(host)
    const act = s.activation
    if (!act) return false
    if (act.rerenderAttemptCount >= MAX_CONTROLLED_RERENDER_PER_ACTIVATION) {
      emitRuntimeAudit('FORMULA-RERENDER-BUDGET', {
        documentKey: act.documentKey,
        activationId: act.activationId,
        signatureHash: act.signatureHash,
        rerenderAttemptCount: act.rerenderAttemptCount,
        maxControlledRerenderPerActivation: MAX_CONTROLLED_RERENDER_PER_ACTIVATION,
        authority: 'ACTIVATION',
        historicalSignatureAttemptCount: this.historicalSignatureAttempts.get(act.signatureHash) ?? 0,
        decision: 'DENIED',
      })
      return false
    }
    act.rerenderAttemptCount++
    emitRuntimeAudit('FORMULA-RERENDER-BUDGET', {
      documentKey: act.documentKey,
      activationId: act.activationId,
      signatureHash: act.signatureHash,
      rerenderAttemptCount: act.rerenderAttemptCount,
      maxControlledRerenderPerActivation: MAX_CONTROLLED_RERENDER_PER_ACTIVATION,
      authority: 'ACTIVATION',
      historicalSignatureAttemptCount: this.historicalSignatureAttempts.get(act.signatureHash) ?? 0,
      decision: 'ALLOWED',
    })
    return true
  }

  /**
   * Phase 7R.3.6-C/E/I: publish a host's plan, minting a NEW activation whenever
   * the semantic signature changes (even for historical signatures). Same
   * signature reuses the current activation. Transition lineage is captured
   * BEFORE the old activation is replaced.
   */
  applyProjectionPlan(
    host: HTMLElement,
    newPlan: FormulaNativeRenderPlan,
    options?: {
      reason?: FormulaAffectedReason
      planSetEpoch?: number
      headingSnapshotRevision?: number
      editorStructureEpoch?: number
    },
  ): { affected: boolean; reason: FormulaAffectedReason; activation: FormulaProjectionActivation | null; transition: FormulaProjectionTransition | null } {
    const old = this.plans.get(host)
    const oldSig = old ? hashProjectionSignature(projectionSignatureOf(host, old)) : ''
    const newSig = hashProjectionSignature(projectionSignatureOf(host, newPlan))
    const s = this.stateOf(host)
    const currentActivation = s.activation

    if (old && oldSig === newSig && currentActivation) {
      // Phase 7R.3.6 §10: same semantic signature → REUSE the current activation
      // (snapshot revision / plan generation / coordinator reruns never mint a
      // new activation). Refresh the plan object only.
      this.plans.set(host, newPlan)
      s.currentPlannedSignatureHash = newSig
      s.executionState = currentActivation.state
      return { affected: false, reason: 'UNCHANGED', activation: currentActivation, transition: null }
    }

    const changeReason: FormulaAffectedReason = options?.reason ?? classifyPlanChange(old, newPlan)
    const transition: FormulaProjectionTransition = {
      formulaHost: host,
      previousActivationId: currentActivation?.activationId ?? null,
      previousSignatureHash: currentActivation?.signatureHash ?? null,
      previousRawNumber: currentActivation?.rawNumber ?? null,
      currentActivationId: this.nextActivationId(),
      currentSignatureHash: newSig,
      currentRawNumber: newPlan.rawNumber,
      reason: transitionReasonOf(changeReason),
    }
    // Phase 7R.3.6 §11: historical attempts are recorded for DIAGNOSTICS ONLY.
    this.historicalSignatureAttempts.set(newSig, (this.historicalSignatureAttempts.get(newSig) ?? 0) + 1)

    const activation: FormulaProjectionActivation = {
      activationId: transition.currentActivationId,
      signatureHash: newSig,
      previousSignatureHash: transition.previousSignatureHash,
      documentKey: newPlan.documentKey,
      sourceHash: newPlan.sourceHash,
      rawNumber: newPlan.rawNumber,
      state: 'plan-ready',
      rerenderAttemptCount: 0,
      injected: false,
      committed: false,
      planSetEpoch: options?.planSetEpoch ?? this.planSetEpochValue,
      headingSnapshotRevision: options?.headingSnapshotRevision ?? newPlan.revision,
      editorStructureEpoch: options?.editorStructureEpoch ?? 0,
      lastInjectedActivationId: null,
      lastInjectedSignatureHash: null,
      lastCommittedActivationId: null,
      lastCommittedSignatureHash: null,
      lastCommittedRawNumber: null,
      lastCommittedPlanSetEpoch: null,
      lastRenderRequestedActivationId: null,
      lastRenderRequestedSignatureHash: null,
    }

    const oldState = s.executionState
    // Bind the plan + source index directly (setPlan would double-mint an
    // activation; the explicit activation below is authoritative).
    this.plans.set(host, newPlan)
    const idxHosts = this.sourceIndex.get(newPlan.sourceHash)
    if (idxHosts) idxHosts.add(host)
    else this.sourceIndex.set(newPlan.sourceHash, new Set([host]))
    s.activation = activation
    s.currentPlannedSignatureHash = newSig
    s.lastLookupDecision = undefined
    s.executionState = 'plan-ready'

    emitRuntimeAudit('FORMULA-PROJECTION-ACTIVATION', {
      documentKey: newPlan.documentKey,
      formulaRuntimeKey: newPlan.formulaRuntimeKey,
      currentActivationId: activation.activationId,
      previousActivationId: transition.previousActivationId,
      currentSignatureHash: newSig,
      previousSignatureHash: transition.previousSignatureHash,
      currentRawNumber: newPlan.rawNumber,
      previousRawNumber: transition.previousRawNumber,
      planSetEpoch: activation.planSetEpoch,
      headingSnapshotRevision: activation.headingSnapshotRevision,
      editorStructureEpoch: activation.editorStructureEpoch,
      rerenderAttemptCount: 0,
      oldExecutionState: oldState,
      newExecutionState: 'plan-ready',
      reason: changeReason,
      decision: 'NEW_ACTIVATION',
    })
    return { affected: true, reason: changeReason, activation, transition }
  }

  /** Clear all plans + state (mode switch, document switch, dispose). */
  clearAll(): void {
    this.plans = new WeakMap<HTMLElement, FormulaNativeRenderPlan>()
    this.sourceIndex = new Map<string, Set<HTMLElement>>()
    this.stateByHost = new WeakMap<HTMLElement, HostProjectionState>()
    this.expectedPlanCount = 0
    // The activation counter / plan-set epoch are MONOTONIC per plugin session —
    // never reset on document switch (keeps activationIds globally unique).
    this.historicalSignatureAttempts = new Map<string, number>()
    this.staleActivationCommitIgnoredCount = 0
    this.staleActivationLookupCount = 0
    this.adoptedExistingSemanticOutputCount = 0
  }

  /**
   * Bind (or refresh) a plan for a host (no diff; used at document bootstrap).
   * Lazily mints an activation whenever the bound signature has no matching
   * current activation, so the execution model is ALWAYS populated.
   */
  setPlan(host: HTMLElement, plan: FormulaNativeRenderPlan): void {
    this.plans.set(host, plan)
    let hosts = this.sourceIndex.get(plan.sourceHash)
    if (!hosts) {
      hosts = new Set()
      this.sourceIndex.set(plan.sourceHash, hosts)
    }
    hosts.add(host)
    const s = this.stateOf(host)
    const sig = hashProjectionSignature(projectionSignatureOf(host, plan))
    s.currentPlannedSignatureHash = sig
    const act = s.activation
    if (!act || act.signatureHash !== sig) {
      const transition: FormulaProjectionTransition = {
        formulaHost: host,
        previousActivationId: act?.activationId ?? null,
        previousSignatureHash: act?.signatureHash ?? null,
        previousRawNumber: act?.rawNumber ?? null,
        currentActivationId: this.nextActivationId(),
        currentSignatureHash: sig,
        currentRawNumber: plan.rawNumber,
        reason: transitionReasonOf(act ? 'SEMANTIC_NUMBER_CHANGED' : 'NEW_FORMULA'),
      }
      s.activation = {
        activationId: transition.currentActivationId,
        signatureHash: sig,
        previousSignatureHash: transition.previousSignatureHash,
        documentKey: plan.documentKey,
        sourceHash: plan.sourceHash,
        rawNumber: plan.rawNumber,
        state: 'plan-ready',
        rerenderAttemptCount: 0,
        injected: false,
        committed: false,
        planSetEpoch: this.planSetEpochValue,
        headingSnapshotRevision: plan.revision,
        editorStructureEpoch: 0,
        lastInjectedActivationId: null,
        lastInjectedSignatureHash: null,
        lastCommittedActivationId: null,
        lastCommittedSignatureHash: null,
        lastCommittedRawNumber: null,
        lastCommittedPlanSetEpoch: null,
        lastRenderRequestedActivationId: null,
        lastRenderRequestedSignatureHash: null,
      }
      // executionState stays 'idle' until a render is actually requested —
      // matching the pre-activation model (setPlan never forces plan-ready).
    }
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
    this.stateOf(host).activation = null
    this.stateOf(host).executionState = 'idle'
  }

  /**
   * Prepare the TRANSIENT render input for one MathJax call.
   * LIVE document context must be passed on every call. The returned decision
   * carries the planSetEpoch/activationId/signatureHash identity so the async
   * output can be guarded against stale activations (Phase 7R.3.6-K).
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

    // Phase 7R.3.6 §36: if the current activation no longer matches the CURRENT
    // plan signature, this lookup is stale — never inject an old activation tag.
    const sig = hashProjectionSignature(projectionSignatureOf(host, plan))
    const s = this.stateOf(host)
    const currentActivation = s.activation
    if (currentActivation && currentActivation.signatureHash !== sig) {
      emitLookup(host, 'STALE_ACTIVATION_LOOKUP')
      this.markStaleActivationLookup(documentKey, plan.formulaRuntimeKey)
      return { tex, injected: false, authority: 'defer', sourceHash }
    }

    // Phase 7R.3.2-C: revision drift on an identical plan is ACCEPTED.
    const revisionDrift = plan.revision !== liveRevision
    const decision: FormulaTransientPlanLookupDecision = revisionDrift
      ? 'REVISION_DRIFT_SEMANTIC_EQUIVALENT_ACCEPTED'
      : 'MATCHED'

    const injectedTex = `${tex}\\tag{${plan.rawNumber}}`
    s.lastLookupDecision = decision
    s.executionState = 'rendering'
    if (currentActivation) {
      currentActivation.injected = true
      currentActivation.lastInjectedActivationId = currentActivation.activationId
      currentActivation.lastInjectedSignatureHash = sig
      currentActivation.state = 'rendering'
    }
    emitLookup(host, decision)
    return {
      tex: injectedTex,
      injected: true,
      authority: 'inkchapter-native-transient',
      sourceHash,
      planSetEpoch: currentActivation?.planSetEpoch ?? this.planSetEpochValue,
      activationId: currentActivation?.activationId ?? null,
      signatureHash: sig,
    }
  }

  /** Mark the CURRENT activation as durably committed (Phase 7R.3.6-L §38-39). */
  markCommitted(host: HTMLElement): void {
    const s = this.stateOf(host)
    const act = s.activation
    if (!act) return
    act.lastCommittedActivationId = act.activationId
    act.lastCommittedSignatureHash = act.signatureHash
    act.lastCommittedRawNumber = act.rawNumber
    act.lastCommittedPlanSetEpoch = act.planSetEpoch
    act.committed = true
    act.state = 'committed'
    s.executionState = 'committed'
    emitRuntimeAudit('FORMULA-COMMIT-STATE', {
      documentKey: act.documentKey,
      activationId: act.activationId,
      signatureHash: act.signatureHash,
      rawNumber: act.rawNumber,
      planSetEpoch: act.planSetEpoch,
      lastCommittedActivationId: act.lastCommittedActivationId,
      lastCommittedSignatureHash: act.lastCommittedSignatureHash,
      lastCommittedRawNumber: act.lastCommittedRawNumber,
      lastCommittedPlanSetEpoch: act.lastCommittedPlanSetEpoch,
      decision: 'COMMITTED',
    })
  }

  /**
   * Phase 7R.3.6 §40: adopt an EXACT already-visible semantic output when the
   * commit metadata was lost. Requires all guard conditions to be verified by
   * the caller (connected host / current documentKey / current sourceHash /
   * inkchapter mode / valid authority / exactly one token / exact match / no
   * duplicate). Marks the current activation durably committed WITHOUT rerender.
   */
  adoptExistingSemanticOutput(host: HTMLElement): boolean {
    const s = this.stateOf(host)
    const act = s.activation
    if (!act) return false
    act.injected = true
    act.lastInjectedActivationId = act.activationId
    act.lastInjectedSignatureHash = act.signatureHash
    act.lastCommittedActivationId = act.activationId
    act.lastCommittedSignatureHash = act.signatureHash
    act.lastCommittedRawNumber = act.rawNumber
    act.lastCommittedPlanSetEpoch = act.planSetEpoch
    act.committed = true
    act.state = 'committed'
    s.executionState = 'committed'
    this.adoptedExistingSemanticOutputCount++
    emitRuntimeAudit('FORMULA-COMMIT-STATE', {
      documentKey: act.documentKey,
      activationId: act.activationId,
      signatureHash: act.signatureHash,
      rawNumber: act.rawNumber,
      planSetEpoch: act.planSetEpoch,
      lastCommittedActivationId: act.lastCommittedActivationId,
      lastCommittedSignatureHash: act.lastCommittedSignatureHash,
      lastCommittedRawNumber: act.lastCommittedRawNumber,
      lastCommittedPlanSetEpoch: act.lastCommittedPlanSetEpoch,
      decision: 'ADOPTED_EXISTING_SEMANTIC_OUTPUT',
    })
    return true
  }

  /** Record a targeted render request for the CURRENT activation. */
  markRenderRequested(host: HTMLElement): void {
    const s = this.stateOf(host)
    const act = s.activation
    if (!act) return
    act.lastRenderRequestedActivationId = act.activationId
    act.lastRenderRequestedSignatureHash = act.signatureHash
    act.state = 'render-requested'
    s.executionState = 'render-requested'
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
