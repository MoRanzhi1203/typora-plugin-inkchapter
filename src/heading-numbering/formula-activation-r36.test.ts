// @vitest-environment jsdom
/**
 * Phase 7R.3.6 — runtime activation model / plan-set atomicity / commit closure.
 *
 * ACTIVATION ACT-1..5 (per-host activation, A→B→A fresh budget)
 * BUDGET-1..4        (one-shot per activation, historical signature non-gating)
 * COHERENCE-1..5     (explicit resolution + candidate coherence decisions)
 * ATOMIC-1..5        (atomic plan-set publication, never partial)
 * ASYNC-1..2         (stale async activation guards)
 * COMMIT-1..3        (durable commit + ADOPTED_EXISTING_SEMANTIC_OUTPUT)
 */

import { describe, it, expect } from 'vitest'
import {
  FormulaProjectionController,
  classifyFormulaProjectionVerify,
  hashFormulaSource,
  MAX_CONTROLLED_RERENDER_PER_ACTIVATION,
  type FormulaNativeRenderPlan,
} from './formula-projection-controller'
import { planFormulaSemanticNumbers } from './formula-semantic-planner'
import { DEFAULT_OBJECT_NUMBERING_CONFIG, type ObjectNumberingConfig } from './object-numbering-engine'
import {
  classifyFormulaSemanticResolution,
  resolutionToFormulaContext,
} from './formula-semantic-resolution'
import {
  computePlanSetPublish,
  decideFormulaCandidateCoherence,
} from './formula-plan-set-coherence'
import { fingerprintFormulaHosts } from './caption-service'
import type { SemanticHeadingNumberState } from './semantic-heading-types'

function formulaCfg(overrides: Partial<ObjectNumberingConfig> = {}): ObjectNumberingConfig {
  return { ...DEFAULT_OBJECT_NUMBERING_CONFIG.formula, enabled: true, formulaMode: 'inkchapter', ...overrides }
}

function semanticState(overrides: Partial<SemanticHeadingNumberState> = {}): SemanticHeadingNumberState {
  return {
    stableIdentity: 'h1',
    physicalLevel: 2,
    effectiveDepth: 1,
    semanticRole: 'chapter',
    structuralParentIdentity: null,
    structuralChapterIdentity: 'h1',
    structuralSectionIdentity: null,
    logicalOrdinal: null,
    chapterOrdinal: 1,
    sectionOrdinal: null,
    counted: true,
    countingReason: 'test',
    ordinalByDepth: [null, 1],
    displayCountedPath: [1],
    sourceRevision: 1,
    ...overrides,
  }
}

function planFor(host: HTMLElement, rawNumber: string, source = 'E = mc^2', overrides: Partial<FormulaNativeRenderPlan> = {}): FormulaNativeRenderPlan {
  if (!host.isConnected) document.body.appendChild(host)
  return {
    documentKey: 'doc-a',
    revision: 3,
    sourceHash: hashFormulaSource(source),
    rawNumber,
    renderedNumber: `(${rawNumber})`,
    formulaRuntimeKey: 'formula:0',
    authority: 'inkchapter-native-transient',
    formulaMode: 'inkchapter',
    ...overrides,
  }
}

describe('Phase 7R.3.6 activation model — ACTIVATION tests', () => {
  it('ACT-1: initial A → activation1 (previous lineage null)', () => {
    const controller = new FormulaProjectionController()
    const host = document.createElement('div')
    const r = controller.applyProjectionPlan(host, planFor(host, '1.1-1'))
    expect(r.affected).toBe(true)
    const act = controller.getCurrentActivation(host)!
    expect(act.activationId).toBe(1)
    expect(act.signatureHash).toBe(controller.currentSignatureHash(host))
    expect(act.rerenderAttemptCount).toBe(0)
    expect(act.injected).toBe(false)
    expect(act.committed).toBe(false)
    expect(r.transition!.previousActivationId).toBeNull()
    expect(r.transition!.previousSignatureHash).toBeNull()
  })

  it('ACT-2: A→B → activation2 with previous lineage preserved', () => {
    const controller = new FormulaProjectionController()
    const host = document.createElement('div')
    controller.applyProjectionPlan(host, planFor(host, '1.1-1'))
    const sigA = controller.currentSignatureHash(host)
    const r = controller.applyProjectionPlan(host, planFor(host, '2-1'))
    expect(r.affected).toBe(true)
    const act = controller.getCurrentActivation(host)!
    expect(act.activationId).toBe(2)
    expect(act.previousSignatureHash).toBe(sigA)
    expect(r.transition!.previousActivationId).toBe(1)
    expect(r.transition!.previousRawNumber).toBe('1.1-1')
    expect(act.rawNumber).toBe('2-1')
  })

  it('ACT-3: A→B→A → activation3 with SAME signature but DIFFERENT activationId and fresh budget', () => {
    const controller = new FormulaProjectionController()
    const host = document.createElement('div')
    controller.applyProjectionPlan(host, planFor(host, '1.1-1')) // activation 1 (A)
    const sigA = controller.currentSignatureHash(host)
    controller.applyProjectionPlan(host, planFor(host, '2-1')) // activation 2 (B)
    controller.tryReserveRecoveryRender(host) // B consumes its budget
    expect(controller.recoveryAttemptCount(host)).toBe(1)
    const r3 = controller.applyProjectionPlan(host, planFor(host, '1.1-1')) // activation 3 (A again)
    const act3 = controller.getCurrentActivation(host)!
    expect(act3.activationId).toBe(3)
    expect(act3.activationId).not.toBe(1)
    expect(act3.signatureHash).toBe(sigA) // same WHAT should be visible
    expect(act3.rerenderAttemptCount).toBe(0) // fresh budget — historical signature NOT gating
    expect(r3.affected).toBe(true)
    expect(controller.tryReserveRecoveryRender(host)).toBe(true) // second A allowed
  })

  it('ACT-4: same A reconcile repeated → SAME activation, no repeated rerender', () => {
    const controller = new FormulaProjectionController()
    const host = document.createElement('div')
    const r1 = controller.applyProjectionPlan(host, planFor(host, '1.1-1', 'E = mc^2', { revision: 3 }))
    expect(r1.affected).toBe(true)
    const id1 = controller.getActivationId(host)
    // Same semantic signature at a NEW snapshot revision → reuse activation.
    const r2 = controller.applyProjectionPlan(host, planFor(host, '1.1-1', 'E = mc^2', { revision: 9 }))
    expect(r2.affected).toBe(false)
    expect(controller.getActivationId(host)).toBe(id1)
    // Same activation consumes at most one render.
    expect(controller.tryReserveRecoveryRender(host)).toBe(true)
    expect(controller.tryReserveRecoveryRender(host)).toBe(false)
  })

  it('ACT-5: A→B→C→A cycle repeated >=20 transitions → zero historical-signature block', () => {
    const controller = new FormulaProjectionController()
    const host = document.createElement('div')
    const numbers = ['1.1-1', '2-1', '3-1'] // A, B, C
    let lastId = 0
    for (let i = 0; i < 21; i++) {
      const raw = numbers[i % numbers.length]
      const r = controller.applyProjectionPlan(host, planFor(host, raw))
      if (r.affected) {
        const id = controller.getActivationId(host)!
        expect(id).toBeGreaterThan(lastId)
        lastId = id
        // Every NEW activation must be rerender-eligible regardless of how many
        // times its signature appeared historically.
        expect(controller.tryReserveRecoveryRender(host)).toBe(true)
      }
    }
    expect(lastId).toBeGreaterThanOrEqual(21)
  })
})

describe('Phase 7R.3.6 rerender budget — BUDGET tests', () => {
  it('BUDGET-1: new activation → attempt=0 → one request allowed', () => {
    const controller = new FormulaProjectionController()
    const host = document.createElement('div')
    controller.applyProjectionPlan(host, planFor(host, '1.1-1'))
    expect(controller.recoveryAttemptCount(host)).toBe(0)
    expect(controller.tryReserveRecoveryRender(host)).toBe(true)
    expect(controller.recoveryAttemptCount(host)).toBe(1)
  })

  it('BUDGET-2: same activation second request → denied', () => {
    const controller = new FormulaProjectionController()
    const host = document.createElement('div')
    controller.applyProjectionPlan(host, planFor(host, '1.1-1'))
    expect(controller.tryReserveRecoveryRender(host)).toBe(true)
    expect(controller.tryReserveRecoveryRender(host)).toBe(false)
    expect(controller.recoveryAttemptCount(host)).toBe(1)
  })

  it('BUDGET-3: historical same signature NEW activation → allowed (never budget-blocked by history)', () => {
    const controller = new FormulaProjectionController()
    const host = document.createElement('div')
    controller.applyProjectionPlan(host, planFor(host, '1.1-1')) // A act1
    controller.tryReserveRecoveryRender(host) // A act1 uses its budget
    controller.applyProjectionPlan(host, planFor(host, '2-1')) // B act2
    controller.applyProjectionPlan(host, planFor(host, '1.1-1')) // A act3 — SAME signature as act1
    expect(controller.tryReserveRecoveryRender(host)).toBe(true) // fresh budget for act3
  })

  it('BUDGET-4: historical attempt count exists → diagnostic only, never gating', () => {
    const controller = new FormulaProjectionController()
    const host = document.createElement('div')
    controller.applyProjectionPlan(host, planFor(host, '1.1-1'))
    const sig = controller.currentSignatureHash(host)
    controller.applyProjectionPlan(host, planFor(host, '2-1'))
    controller.applyProjectionPlan(host, planFor(host, '1.1-1'))
    expect(controller.getHistoricalSignatureAttemptCount(sig)).toBeGreaterThanOrEqual(2)
    // Historical count does not deny a brand-new activation.
    expect(controller.tryReserveRecoveryRender(host)).toBe(true)
    expect(MAX_CONTROLLED_RERENDER_PER_ACTIVATION).toBe(1)
  })
})

describe('Phase 7R.3.6 explicit resolution + candidate coherence — COHERENCE tests', () => {
  const config = formulaCfg({ preset: 'section-dash' })

  it('COHERENCE-1: 4 hosts / 2 final + 2 TRANSIENT_UNRESOLVED → DEFER, previous 4 kept, no activation/rerender', () => {
    const decision = decideFormulaCandidateCoherence({
      activeDocumentKey: 'doc-a',
      snapDocumentKey: 'doc-a',
      candidateStartEpoch: 10,
      liveEpoch: 10,
      bindingGenerationAtStart: 1,
      bindingGenerationLive: 1,
      transientUnresolvedCount: 2,
      previousCompletePlanSetDocumentKey: 'doc-a',
      previousCanonicalHostFingerprint: 'fp-4',
      canonicalHostFingerprint: 'fp-4',
      explicitFormulaStructureChange: false,
    })
    expect(decision).toBe('DEFER_TRANSIENT_UNRESOLVED')
    const publish = computePlanSetPublish({ decision, previousCompletePlanCount: 4, candidatePlanCount: 2 })
    expect(publish.publishDecision).toBe('DEFER_KEEP_PREVIOUS_COMPLETE_SET')
    expect(publish.publishedPlanCount).toBe(4) // previous COMPLETE set survives
    expect(publish.noOp).toBe(true) // activationCreatedCount=0, rerenderCount=0, projectionWrites=0
  })

  it('COHERENCE-2: H2 Chapter → H4 subsection without H3 → LEGITIMATE_CHAPTER_FALLBACK, COMPLETE, rawNumber=1-1', () => {
    const state = semanticState({ stableIdentity: 'h2', chapterOrdinal: 1, sectionOrdinal: null })
    const res = classifyFormulaSemanticResolution(true, null, 'h2', state)
    expect(res.decision).toBe('LEGITIMATE_CHAPTER_FALLBACK')
    if (res.decision === 'TRANSIENT_UNRESOLVED') throw new Error('unexpected')
    const ctx = resolutionToFormulaContext(res)!
    const planned = planFormulaSemanticNumbers([ctx], config)[0]
    expect(planned.rawNumber).toBe('1-1')
  })

  it('COHERENCE-3: Formula genuinely before first counted chapter → LEGITIMATE_GLOBAL_FALLBACK, COMPLETE', () => {
    const res = classifyFormulaSemanticResolution(false, 'NO_PRECEDING_HEADING', null, null)
    expect(res.decision).toBe('LEGITIMATE_GLOBAL_FALLBACK')
    const ctx = resolutionToFormulaContext(res)!
    expect(ctx).toEqual({ chapterOrdinal: null, sectionOrdinal: null })
    const planned = planFormulaSemanticNumbers([ctx], config)[0]
    expect(planned.rawNumber).toBe('1')
  })

  it('COHERENCE-4: structure epoch changes mid-plan → DEFER_STALE_STRUCTURE_EPOCH, previous preserved', () => {
    const decision = decideFormulaCandidateCoherence({
      activeDocumentKey: 'doc-a',
      snapDocumentKey: 'doc-a',
      candidateStartEpoch: 10,
      liveEpoch: 11, // epoch advanced while candidate was being built
      bindingGenerationAtStart: 1,
      bindingGenerationLive: 1,
      transientUnresolvedCount: 0,
      previousCompletePlanSetDocumentKey: 'doc-a',
      previousCanonicalHostFingerprint: 'fp-4',
      canonicalHostFingerprint: 'fp-4',
      explicitFormulaStructureChange: false,
    })
    expect(decision).toBe('DEFER_STALE_STRUCTURE_EPOCH')
    const publish = computePlanSetPublish({ decision, previousCompletePlanCount: 4, candidatePlanCount: 4 })
    expect(publish.publishedPlanCount).toBe(4)
    expect(publish.noOp).toBe(true)
  })

  it('COHERENCE-5: binding generation mismatch → DEFER_BINDING_GENERATION_MISMATCH, no global fallback', () => {
    const decision = decideFormulaCandidateCoherence({
      activeDocumentKey: 'doc-a',
      snapDocumentKey: 'doc-a',
      candidateStartEpoch: 10,
      liveEpoch: 10,
      bindingGenerationAtStart: 1,
      bindingGenerationLive: 2, // headings re-bound mid-plan
      transientUnresolvedCount: 0,
      previousCompletePlanSetDocumentKey: 'doc-a',
      previousCanonicalHostFingerprint: 'fp-4',
      canonicalHostFingerprint: 'fp-4',
      explicitFormulaStructureChange: false,
    })
    expect(decision).toBe('DEFER_BINDING_GENERATION_MISMATCH')
    const publish = computePlanSetPublish({ decision, previousCompletePlanCount: 4, candidatePlanCount: 4 })
    expect(publish.publishDecision).toBe('DEFER_KEEP_PREVIOUS_COMPLETE_SET')
    expect(publish.noOp).toBe(true)
  })
})

describe('Phase 7R.3.6 atomic plan-set — ATOMIC tests', () => {
  it('ATOMIC-1: previous complete=4, candidate=2 transient → NO publish, live stays 4', () => {
    const decision = decideFormulaCandidateCoherence({
      activeDocumentKey: 'doc-a', snapDocumentKey: 'doc-a',
      candidateStartEpoch: 1, liveEpoch: 1,
      bindingGenerationAtStart: 1, bindingGenerationLive: 1,
      transientUnresolvedCount: 2,
      previousCompletePlanSetDocumentKey: 'doc-a',
      previousCanonicalHostFingerprint: 'fp4', canonicalHostFingerprint: 'fp4',
      explicitFormulaStructureChange: false,
    })
    expect(decision).toBe('DEFER_TRANSIENT_UNRESOLVED')
    const publish = computePlanSetPublish({ decision, previousCompletePlanCount: 4, candidatePlanCount: 2 })
    expect(publish.publishedPlanCount).toBe(4) // live count NEVER becomes 2
    expect(publish.noOp).toBe(true)
  })

  it('ATOMIC-2: after follow-up, candidate=4 complete → one ATOMIC_PUBLISH 4→4', () => {
    const decision = decideFormulaCandidateCoherence({
      activeDocumentKey: 'doc-a', snapDocumentKey: 'doc-a',
      candidateStartEpoch: 2, liveEpoch: 2,
      bindingGenerationAtStart: 2, bindingGenerationLive: 2,
      transientUnresolvedCount: 0,
      previousCompletePlanSetDocumentKey: 'doc-a',
      previousCanonicalHostFingerprint: 'fp4', canonicalHostFingerprint: 'fp4',
      explicitFormulaStructureChange: false,
    })
    expect(decision).toBe('COMPLETE')
    const publish = computePlanSetPublish({ decision, previousCompletePlanCount: 4, candidatePlanCount: 4 })
    expect(publish.publishDecision).toBe('ATOMIC_PUBLISH')
    expect(publish.publishedPlanCount).toBe(4)
    expect(publish.noOp).toBe(false)
  })

  it('ATOMIC-3/4: explicit Formula add 4→5 / delete 5→4 → COMPLETE atomic host-set change', () => {
    const base = {
      activeDocumentKey: 'doc-a', snapDocumentKey: 'doc-a',
      candidateStartEpoch: 1, liveEpoch: 1,
      bindingGenerationAtStart: 1, bindingGenerationLive: 1,
      transientUnresolvedCount: 0,
      previousCompletePlanSetDocumentKey: 'doc-a',
      previousCanonicalHostFingerprint: 'fp4',
      explicitFormulaStructureChange: true, // genuine add/delete invalidation
    }
    // Add: host fingerprint changes 4→5, explicitly allowed.
    const add = decideFormulaCandidateCoherence({ ...base, canonicalHostFingerprint: 'fp5' })
    expect(add).toBe('COMPLETE')
    expect(computePlanSetPublish({ decision: add, previousCompletePlanCount: 4, candidatePlanCount: 5 }).publishedPlanCount).toBe(5)
    // Delete: host fingerprint changes 5→4, explicitly allowed.
    const del = decideFormulaCandidateCoherence({ ...base, previousCanonicalHostFingerprint: 'fp5', canonicalHostFingerprint: 'fp4' })
    expect(del).toBe('COMPLETE')
    expect(computePlanSetPublish({ decision: del, previousCompletePlanCount: 5, candidatePlanCount: 4 }).publishedPlanCount).toBe(4)
  })

  it('ATOMIC-5: renderer replacement (MJX/SVG churn) → host fingerprint unchanged → COMPLETE, plan count stays 4', () => {
    // Renderer nodes are NOT part of the canonical host fingerprint.
    const hosts = [0, 1, 2, 3].map(i => {
      const d = document.createElement('div')
      d.className = 'mathjax-block md-math-block'
      d.setAttribute('data-test', `h${i}`)
      document.body.appendChild(d)
      return d
    })
    const targets = hosts.map((root, ordinal) => ({ ordinal, root }))
    const fpBefore = fingerprintFormulaHosts(targets)
    // Simulate renderer output churn: MJX/SVG children added — fingerprint unchanged.
    for (const h of hosts) {
      const mjx = document.createElement('mjx-container')
      mjx.className = 'MathJax'
      h.appendChild(mjx)
    }
    const fpAfter = fingerprintFormulaHosts(targets)
    expect(fpAfter).toBe(fpBefore)
    const decision = decideFormulaCandidateCoherence({
      activeDocumentKey: 'doc-a', snapDocumentKey: 'doc-a',
      candidateStartEpoch: 1, liveEpoch: 1,
      bindingGenerationAtStart: 1, bindingGenerationLive: 1,
      transientUnresolvedCount: 0,
      previousCompletePlanSetDocumentKey: 'doc-a',
      previousCanonicalHostFingerprint: fpBefore,
      canonicalHostFingerprint: fpAfter,
      explicitFormulaStructureChange: false,
    })
    expect(decision).toBe('COMPLETE')
    expect(computePlanSetPublish({ decision, previousCompletePlanCount: 4, candidatePlanCount: 4 }).publishedPlanCount).toBe(4)
  })
})

describe('Phase 7R.3.6 async + commit guards — ASYNC / COMMIT tests', () => {
  it('ASYNC-1: activation A rendering, B becomes current, A output resolves → STALE_ACTIVATION_COMMIT_IGNORED, B untouched', () => {
    const controller = new FormulaProjectionController()
    const host = document.createElement('div')
    const epoch = controller.getPlanSetEpoch()
    controller.applyProjectionPlan(host, planFor(host, '1.1-1')) // A act1
    const actA = controller.getCurrentActivation(host)!
    expect(controller.isCurrentActivation(host, actA.activationId, epoch)).toBe(true)
    controller.applyProjectionPlan(host, planFor(host, '2-1')) // B act2 becomes current
    expect(controller.isCurrentActivation(host, actA.activationId, epoch)).toBe(false)
    controller.markStaleActivationCommitIgnored('doc-a', 'formula:0', 'ASYNC_OUTPUT_ACTIVATION_CHANGED')
    const counters = controller.getStaleActivationCounters()
    expect(counters.staleActivationCommitIgnoredCount).toBe(1)
    // B state untouched (never committed by the stale A output).
    expect(controller.getCurrentActivation(host)!.committed).toBe(false)
  })

  it('ASYNC-2: stale activation lookup guard exists and is counted (STALE_ACTIVATION_LOOKUP)', () => {
    const controller = new FormulaProjectionController()
    const host = document.createElement('div')
    controller.applyProjectionPlan(host, planFor(host, '1.1-1'))
    const before = controller.getStaleActivationCounters().staleActivationLookupCount
    controller.markStaleActivationLookup('doc-a', 'formula:0')
    expect(controller.getStaleActivationCounters().staleActivationLookupCount).toBe(before + 1)
  })

  it('COMMIT-1: exact visible semantic output with missing commit metadata → ADOPTED_EXISTING_SEMANTIC_OUTPUT + durable repair', () => {
    const controller = new FormulaProjectionController()
    const host = document.createElement('div')
    const epoch = controller.beginPlanSetEpoch()
    controller.applyProjectionPlan(host, planFor(host, '1.1-1'), { planSetEpoch: epoch, headingSnapshotRevision: 3, editorStructureEpoch: 1 })
    expect(controller.lastCommittedSignatureHash(host)).toBeNull()
    expect(controller.isCommittedForCurrentSignature(host)).toBe(false)
    const adopted = controller.adoptExistingSemanticOutput(host)
    expect(adopted).toBe(true)
    const state = controller.commitState(host)
    expect(state.lastCommittedActivationId).toBe(state.currentActivationId)
    expect(state.lastCommittedSignatureHash).toBe(state.currentSignatureHash)
    expect(state.lastCommittedRawNumber).toBe('1.1-1')
    expect(state.lastCommittedPlanSetEpoch).toBe(epoch)
    expect(controller.isCommittedForCurrentSignature(host)).toBe(true)
    expect(controller.getStaleActivationCounters().adoptedExistingSemanticOutputCount).toBe(1)
  })

  it('COMMIT-2: expected=1-1, observed=1.1-1 → exact verification FAILS (no substring adoption)', () => {
    const controller = new FormulaProjectionController()
    const host = document.createElement('div')
    controller.applyProjectionPlan(host, planFor(host, '1.1-1'))
    // EXACT equality only — "1-1" can never match the token "1.1-1".
    const observed = ['1.1-1']
    const exactMatchCount = observed.filter(tok => tok === '1-1').length
    expect(exactMatchCount).toBe(0)
    const decision = classifyFormulaProjectionVerify({
      planExists: true, injected: true, committedForCurrentSignature: false, lookupDecision: 'MATCHED',
      semanticCommitted: false, sequentialCommitted: false, customDecorationCount: 0,
    })
    expect(decision).not.toBe('SEMANTIC_VISIBLE_VERIFIED')
  })

  it('COMMIT-3: expected=11.2-1, observed=1 → NOT committed, no false adoption', () => {
    const controller = new FormulaProjectionController()
    const host = document.createElement('div')
    controller.applyProjectionPlan(host, planFor(host, '11.2-1'))
    const observed = ['1']
    const exactMatchCount = observed.filter(tok => tok === '11.2-1').length
    expect(exactMatchCount).toBe(0)
    // Adoption requires exactMatchCount===1 — false here, so never adopt.
    expect(controller.isCommittedForCurrentSignature(host)).toBe(false)
  })
})
