/**
 * Formula Plan-Set Coherence (Phase 7R.3.6-I/J)
 *
 * PURE decision helpers for the atomic Formula plan-set publication flow:
 *
 *   - decideFormulaCandidateCoherence(): given the provenance captured at
 *     candidate start and the live values at publication time, decide whether
 *     the candidate is COMPLETE or must be DEFERRED (keeping the previous
 *     COMPLETE plan set untouched).
 *   - computePlanSetPublish(): the atomic publish bookkeeping decision —
 *     ATOMIC_PUBLISH vs DEFER_KEEP_PREVIOUS_COMPLETE_SET, with the exact
 *     published plan count invariant.
 *
 * No DOM, no controller, no audit — fully unit-testable (COHERENCE-1..5 /
 * ATOMIC-1..5).
 */

export type FormulaCandidateCoherenceDecision =
  | 'COMPLETE'
  | 'DEFER_STALE_STRUCTURE_EPOCH'
  | 'DEFER_BINDING_GENERATION_MISMATCH'
  | 'DEFER_TRANSIENT_UNRESOLVED'
  | 'DEFER_HOST_SET_TRANSIENT'
  | 'DEFER_DOCUMENT_MISMATCH'

export type FormulaPlanSetPublishDecision =
  | 'ATOMIC_PUBLISH'
  | 'DEFER_KEEP_PREVIOUS_COMPLETE_SET'
  | 'DOCUMENT_SWITCH_RESET'

export interface CandidateCoherenceInput {
  activeDocumentKey: string | null
  snapDocumentKey: string
  candidateStartEpoch: number
  liveEpoch: number
  bindingGenerationAtStart: number
  bindingGenerationLive: number
  transientUnresolvedCount: number
  /** Previous COMPLETE plan set exists for the SAME document. */
  previousCompletePlanSetDocumentKey: string | null
  previousCanonicalHostFingerprint: string
  canonicalHostFingerprint: string
  /** Explicit, canonical Formula host add/remove invalidation (Phase 7R.3.6 §25). */
  explicitFormulaStructureChange: boolean
}

/**
 * Phase 7R.3.6-I §24: candidate completeness decision.
 *   - document mismatch → DEFER_DOCUMENT_MISMATCH
 *   - editor structure epoch advanced mid-plan → DEFER_STALE_STRUCTURE_EPOCH
 *   - binding generation advanced mid-plan → DEFER_BINDING_GENERATION_MISMATCH
 *   - any TRANSIENT_UNRESOLVED Formula → DEFER_TRANSIENT_UNRESOLVED
 *   - canonical host set changed WITHOUT an explicit Formula structure change →
 *     DEFER_HOST_SET_TRANSIENT (renderer churn must never count as add/remove)
 *   - otherwise → COMPLETE
 */
export function decideFormulaCandidateCoherence(input: CandidateCoherenceInput): FormulaCandidateCoherenceDecision {
  if (input.activeDocumentKey !== input.snapDocumentKey) return 'DEFER_DOCUMENT_MISMATCH'
  if (input.liveEpoch !== input.candidateStartEpoch) return 'DEFER_STALE_STRUCTURE_EPOCH'
  if (input.bindingGenerationLive !== input.bindingGenerationAtStart) return 'DEFER_BINDING_GENERATION_MISMATCH'
  if (input.transientUnresolvedCount > 0) return 'DEFER_TRANSIENT_UNRESOLVED'
  if (
    !input.explicitFormulaStructureChange
    && input.previousCompletePlanSetDocumentKey === input.snapDocumentKey
    && input.previousCanonicalHostFingerprint !== ''
    && input.previousCanonicalHostFingerprint !== input.canonicalHostFingerprint
  ) {
    return 'DEFER_HOST_SET_TRANSIENT'
  }
  return 'COMPLETE'
}

export interface PlanSetPublishInput {
  decision: FormulaCandidateCoherenceDecision
  previousCompletePlanCount: number
  candidatePlanCount: number
}

export interface PlanSetPublishOutcome {
  publishDecision: FormulaPlanSetPublishDecision
  publishedPlanCount: number
  /**
   * Phase 7R.3.6 §45 invariant: for any deferred candidate,
   * publishedPlanCount === previousCompletePlanCount, and the publish is a
   * no-op (activationCreatedCount=0, controlledRerenderRequestedCount=0,
   * projectionWrites=0).
   */
  noOp: boolean
}

/**
 * Phase 7R.3.6-I §27/§45: atomic publish bookkeeping. A COMPLETE candidate is
 * published with its own plan count; any DEFER keeps the previous COMPLETE
 * plan set byte-for-byte (publishedPlanCount === previousCompletePlanCount).
 */
export function computePlanSetPublish(input: PlanSetPublishInput): PlanSetPublishOutcome {
  if (input.decision === 'COMPLETE') {
    return {
      publishDecision: 'ATOMIC_PUBLISH',
      publishedPlanCount: input.candidatePlanCount,
      noOp: false,
    }
  }
  return {
    publishDecision: 'DEFER_KEEP_PREVIOUS_COMPLETE_SET',
    publishedPlanCount: input.previousCompletePlanCount,
    noOp: true,
  }
}
