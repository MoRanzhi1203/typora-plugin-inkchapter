import { describe, expect, it } from 'vitest'

import {
  evaluateSemanticReconcileDecision,
  type MutationShapeV1,
  type SemanticReconcileDecisionInput,
} from './document-utility-mutation-provenance-v1'

/**
 * P0 DET — a REAL paragraph-structure mutation must never be short-circuited as
 * a duplicate semantic state.
 *
 * The observed defect: an Enter that produced `SPLIT_1_TO_2` (and the symmetric
 * `MERGE_2_TO_1` / `COMPLEX` batches) reached this router with an unchanged
 * heading-derived state key, so `NOOP_DUPLICATE_SEMANTIC_STATE` dropped the whole
 * semantic pass. The paragraph shape IS independent evidence that the content
 * structure changed, so the duplicate-state shortcut may only apply to a batch
 * that provably touched no paragraph (shape NONE).
 */
function input(overrides: Partial<SemanticReconcileDecisionInput> & { mutationShape: MutationShapeV1 }): SemanticReconcileDecisionInput {
  return {
    provenance: 'USER_CONTENT',
    sourceRevisionChanged: false,
    canonicalStructureChanged: false,
    semanticFingerprintChanged: false,
    stateKey: 'doc|1|2|fp',
    previousStateKey: 'doc|1|2|fp',
    pluginInteractionActive: false,
    businessHostTouched: false,
    ...overrides,
  }
}

describe('DET — structural mutation shape must defeat the duplicate-state shortcut', () => {
  it('SPLIT_1_TO_2 with an unchanged state key is reconciled (not NOOP)', () => {
    const decision = evaluateSemanticReconcileDecision(input({ mutationShape: 'SPLIT_1_TO_2' }))
    expect(decision.decision).toBe('SEMANTIC_RECONCILE_ALLOWED')
    expect(decision.semanticReconcileAllowed).toBe(true)
  })

  it('MERGE_2_TO_1 with an unchanged state key is reconciled (not NOOP)', () => {
    const decision = evaluateSemanticReconcileDecision(input({ mutationShape: 'MERGE_2_TO_1' }))
    expect(decision.decision).toBe('SEMANTIC_RECONCILE_ALLOWED')
  })

  it('COMPLEX with an unchanged state key is reconciled (not NOOP)', () => {
    const decision = evaluateSemanticReconcileDecision(input({ mutationShape: 'COMPLEX' }))
    expect(decision.decision).toBe('SEMANTIC_RECONCILE_ALLOWED')
  })

  it('REPLACE_1_TO_1 with an unchanged state key is reconciled (not NOOP)', () => {
    const decision = evaluateSemanticReconcileDecision(input({ mutationShape: 'REPLACE_1_TO_1' }))
    expect(decision.decision).toBe('SEMANTIC_RECONCILE_ALLOWED')
  })

  it('NONE with a truly duplicate state key stays short-circuited (perf contract)', () => {
    const decision = evaluateSemanticReconcileDecision(input({ mutationShape: 'NONE' }))
    // Either short-circuit is acceptable: the contract is "no semantic pass".
    expect(['NOOP_DUPLICATE_SEMANTIC_STATE', 'NO_SEMANTIC_RECONCILE']).toContain(decision.decision)
    expect(decision.semanticReconcileAllowed).toBe(false)
  })

  it('plugin presentation writes still short-circuit regardless of shape', () => {
    const decision = evaluateSemanticReconcileDecision(input({
      mutationShape: 'SPLIT_1_TO_2',
      provenance: 'PLUGIN_PRESENTATION',
    }))
    expect(decision.decision).toBe('PLUGIN_PRESENTATION_SHORT_CIRCUIT')
  })

  it('an independent structural change still reconciles with shape NONE', () => {
    const decision = evaluateSemanticReconcileDecision(input({
      mutationShape: 'NONE',
      canonicalStructureChanged: true,
    }))
    expect(decision.decision).toBe('SEMANTIC_RECONCILE_ALLOWED')
  })
})
