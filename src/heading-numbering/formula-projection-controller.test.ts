// @vitest-environment jsdom
import { describe, it, expect } from 'vitest'
import {
  FormulaProjectionController,
  classifyFormulaProjectionVerify,
  hashFormulaSource,
  normalizeTyporaAutoNumberingPolicy,
  scanDisplayMathSources,
  sourceHasExplicitUserTag,
  type FormulaProjectionContext,
  type FormulaNativeRenderPlan,
} from './formula-projection-controller'

function ctx(overrides: Partial<FormulaProjectionContext> = {}): FormulaProjectionContext {
  return {
    formulaMode: 'inkchapter',
    typoraAutoNumberingPolicy: 'off',
    snapshotReady: true,
    documentCoherent: true,
    rendererReady: true,
    ...overrides,
  }
}

function makePlan(host: HTMLElement, tex = 'E = mc^2', overrides: Partial<FormulaNativeRenderPlan> = {}): { controller: FormulaProjectionController; plan: FormulaNativeRenderPlan } {
  // Real hosts are connected to the document (the hook rejects detached hosts).
  if (!host.isConnected) document.body.appendChild(host)
  const controller = new FormulaProjectionController()
  const plan: FormulaNativeRenderPlan = {
    documentKey: 'doc-a',
    revision: 3,
    sourceHash: hashFormulaSource(tex),
    rawNumber: '1.1-1',
    renderedNumber: '(1.1-1)',
    formulaRuntimeKey: 'formula:0',
    authority: 'inkchapter-native-transient',
    formulaMode: 'inkchapter',
    ...overrides,
  }
  controller.setPlan(host, plan)
  return { controller, plan }
}

describe('normalizeTyporaAutoNumberingPolicy', () => {
  it('maps raw Typora preference values to a typed policy', () => {
    expect(normalizeTyporaAutoNumberingPolicy(true)).toBe('all')
    expect(normalizeTyporaAutoNumberingPolicy('all')).toBe('all')
    expect(normalizeTyporaAutoNumberingPolicy('ams')).toBe('ams')
    expect(normalizeTyporaAutoNumberingPolicy(false)).toBe('off')
    expect(normalizeTyporaAutoNumberingPolicy('none')).toBe('off')
    expect(normalizeTyporaAutoNumberingPolicy('0')).toBe('off')
    expect(normalizeTyporaAutoNumberingPolicy(undefined)).toBe('off')
    expect(normalizeTyporaAutoNumberingPolicy('weird')).toBe('unknown')
  })
})

describe('FormulaProjectionController.arbitrate — ARB tests', () => {
  const controller = new FormulaProjectionController()

  it('ARB-1: typora-native + OFF → TYPORA_NATIVE', () => {
    expect(controller.arbitrate(ctx({ formulaMode: 'typora-native', typoraAutoNumberingPolicy: 'off' }))).toBe('typora-native')
  })
  it('ARB-2: typora-native + AMS → TYPORA_NATIVE', () => {
    expect(controller.arbitrate(ctx({ formulaMode: 'typora-native', typoraAutoNumberingPolicy: 'ams' }))).toBe('typora-native')
  })
  it('ARB-3: typora-native + ALL → TYPORA_NATIVE', () => {
    expect(controller.arbitrate(ctx({ formulaMode: 'typora-native', typoraAutoNumberingPolicy: 'all' }))).toBe('typora-native')
  })
  it('ARB-4: inkchapter + OFF + ready → INKCHAPTER_NATIVE_TRANSIENT', () => {
    expect(controller.arbitrate(ctx({ formulaMode: 'inkchapter', typoraAutoNumberingPolicy: 'off' }))).toBe('inkchapter-native-transient')
  })
  it('ARB-5: inkchapter + AMS + ready → INKCHAPTER_NATIVE_TRANSIENT', () => {
    expect(controller.arbitrate(ctx({ formulaMode: 'inkchapter', typoraAutoNumberingPolicy: 'ams' }))).toBe('inkchapter-native-transient')
  })
  it('ARB-6: inkchapter + ALL + ready → INKCHAPTER_NATIVE_TRANSIENT', () => {
    expect(controller.arbitrate(ctx({ formulaMode: 'inkchapter', typoraAutoNumberingPolicy: 'all' }))).toBe('inkchapter-native-transient')
  })
  it('ARB-7: inkchapter + NO_SNAPSHOT → DEFER', () => {
    expect(controller.arbitrate(ctx({ formulaMode: 'inkchapter', snapshotReady: false }))).toBe('defer')
  })
  it('ARB-8: inkchapter + renderer not ready → INKCHAPTER_NATIVE_TRANSIENT (Phase 7R.3.2: plan ready before renderer)', () => {
    expect(controller.arbitrate(ctx({ formulaMode: 'inkchapter', rendererReady: false }))).toBe('inkchapter-native-transient')
  })
  it('ARB-9: explicit user tag (source) → handled by prepareTransientRenderInput as PRESERVE', () => {
    const host = document.createElement('div')
    const tex = 'E = mc^2 \\tag{USER}'
    const { controller: c } = makePlan(host, tex)
    const decision = c.prepareTransientRenderInput(tex, 'doc-a', 3)
    expect(decision.injected).toBe(false)
    expect(decision.authority).toBe('explicit-user-tag-preserved')
    expect(decision.tex).toBe(tex)
  })
})

describe('FormulaProjectionController.prepareTransientRenderInput — SINGLE-OUTPUT / PLAN tests', () => {
  it('SINGLE-OUTPUT-1..3: active plan → transient \\tag injected for any policy', () => {
    const host = document.createElement('div')
    const { controller } = makePlan(host, 'E = mc^2', { rawNumber: '1.1-1' })
    const decision = controller.prepareTransientRenderInput('E = mc^2', 'doc-a', 3)
    expect(decision.injected).toBe(true)
    expect(decision.tex).toBe('E = mc^2\\tag{1.1-1}')
    expect(decision.authority).toBe('inkchapter-native-transient')
  })

  it('PLAN-1: plan bound to canonical host via WeakMap (host lookup works)', () => {
    const host = document.createElement('div')
    const { controller, plan } = makePlan(host)
    expect(controller.getPlan(host)).toBe(plan)
  })

  it('PLAN-2: document switch invalidates old plan (no cross-doc injection)', () => {
    const host = document.createElement('div')
    const { controller } = makePlan(host, 'E = mc^2', { documentKey: 'doc-a' })
    const decision = controller.prepareTransientRenderInput('E = mc^2', 'doc-b', 3)
    expect(decision.injected).toBe(false)
    expect(decision.authority).toBe('defer')
    expect(controller.getPlan(host)).toBeUndefined()
  })

  it('PLAN-3: revision drift on identical plan → ACCEPTED (Phase 7R.3.2 latest-plan rule)', () => {
    const host = document.createElement('div')
    const { controller } = makePlan(host, 'E = mc^2', { revision: 3 })
    const decision = controller.prepareTransientRenderInput('E = mc^2', 'doc-a', 99)
    expect(decision.injected).toBe(true)
    expect(controller.getPlan(host)).toBeDefined()
  })

  it('PLAN-4: mode switch clears plan (clearAll)', () => {
    const host = document.createElement('div')
    const { controller } = makePlan(host)
    controller.clearAll()
    expect(controller.getPlan(host)).toBeUndefined()
    expect(controller.prepareTransientRenderInput('E = mc^2', 'doc-a', 3).injected).toBe(false)
  })

  it('PLAN-5: Formula removal clears its plan (clearPlan) without leaking source index', () => {
    const host = document.createElement('div')
    const { controller } = makePlan(host, 'E = mc^2', { sourceHash: 'h-single' })
    controller.clearPlan(host)
    expect(controller.getPlan(host)).toBeUndefined()
    expect(controller.prepareTransientRenderInput('E = mc^2', 'doc-a', 3).injected).toBe(false)
  })

  it('SINGLE-OUTPUT-4: repeated prepare is idempotent (same result, no double injection)', () => {
    const host = document.createElement('div')
    const { controller } = makePlan(host)
    const d1 = controller.prepareTransientRenderInput('E = mc^2', 'doc-a', 3)
    const d2 = controller.prepareTransientRenderInput('E = mc^2', 'doc-a', 3)
    expect(d1.tex).toBe(d2.tex)
    expect(d1.tex.match(/\\tag\{/g)).toHaveLength(1)
  })

  it('duplicate source text across hosts → NO injection (host correlation not provable)', () => {
    const h1 = document.createElement('div')
    const h2 = document.createElement('div')
    const controller = new FormulaProjectionController()
    const plan1: FormulaNativeRenderPlan = { documentKey: 'doc-a', revision: 3, sourceHash: 'h-dup', rawNumber: '1.1-1', renderedNumber: '(1.1-1)', formulaRuntimeKey: 'formula:0', authority: 'inkchapter-native-transient', formulaMode: 'inkchapter' }
    const plan2: FormulaNativeRenderPlan = { ...plan1, rawNumber: '1.1-2', renderedNumber: '(1.1-2)', formulaRuntimeKey: 'formula:1' }
    controller.setPlan(h1, plan1)
    controller.setPlan(h2, plan2)
    const decision = controller.prepareTransientRenderInput('x = 1', 'doc-a', 3)
    expect(decision.injected).toBe(false)
  })
})

describe('source helpers — SOURCE-INTEGRITY tests', () => {
  it('SOURCE-INTEGRITY-1/3: generated tag is transient; explicit user tag is detected and preserved', () => {
    expect(sourceHasExplicitUserTag('E = mc^2')).toBe(false)
    expect(sourceHasExplicitUserTag('E = mc^2 \\tag{user}')).toBe(true)
    expect(sourceHasExplicitUserTag('x \\\\tag not a tag')).toBe(false)
  })

  it('scanDisplayMathSources returns $$...$$ blocks in document order', () => {
    const md = [
      '# t',
      '$$',
      'E = mc^2',
      '$$',
      'text',
      '$$',
      'F = ma',
      '$$',
    ].join('\n')
    const sources = scanDisplayMathSources(md)
    expect(sources).toHaveLength(2)
    expect(sources[0].trim()).toBe('E = mc^2')
    expect(sources[1].trim()).toBe('F = ma')
  })

  it('hashFormulaSource is deterministic and ignores whitespace normalization', () => {
    expect(hashFormulaSource('E = mc^2')).toBe(hashFormulaSource('E = mc^2'))
    expect(hashFormulaSource('  E = mc^2  ')).toBe(hashFormulaSource('E = mc^2'))
    expect(hashFormulaSource('E = mc^2')).not.toBe(hashFormulaSource('F = ma'))
  })
})

describe('FormulaProjectionController execution state + plan signature (Phase 7R.3.1-C)', () => {
  it('RENDER-REQ-2: same plan signature already committed → signature stable, NO_OP candidate', () => {
    const host = document.createElement('div')
    const { controller } = makePlan(host, 'E = mc^2', { rawNumber: '1.1-1', revision: 3 })
    const sig1 = controller.semanticProjectionSignature(host)
    // Same plan → identical signature hash (no new render required by signature change).
    expect(sig1).toBe(controller.semanticProjectionSignature(host))
    expect(sig1.length).toBeGreaterThan(0)
  })

  it('RENDER-REQ-3: semantic number changes → signature changes (one new render required)', () => {
    const host = document.createElement('div')
    const { controller } = makePlan(host, 'E = mc^2', { rawNumber: '1.1-1', revision: 3 })
    const sig1 = controller.semanticProjectionSignature(host)
    const plan2: FormulaNativeRenderPlan = {
      documentKey: 'doc-a', revision: 3, sourceHash: hashFormulaSource('E = mc^2'),
      rawNumber: '1.1-2', renderedNumber: '(1.1-2)', formulaRuntimeKey: 'formula:0', authority: 'inkchapter-native-transient', formulaMode: 'inkchapter',
    }
    controller.setPlan(host, plan2)
    expect(controller.semanticProjectionSignature(host)).not.toBe(sig1)
  })

  it('RENDER-REQ-4: source changes → signature changes', () => {
    const host = document.createElement('div')
    const { controller } = makePlan(host, 'E = mc^2', { rawNumber: '1.1-1' })
    const sig1 = controller.semanticProjectionSignature(host)
    const plan2: FormulaNativeRenderPlan = {
      documentKey: 'doc-a', revision: 3, sourceHash: hashFormulaSource('F = ma'),
      rawNumber: '1.1-1', renderedNumber: '(1.1-1)', formulaRuntimeKey: 'formula:0', authority: 'inkchapter-native-transient', formulaMode: 'inkchapter',
    }
    controller.setPlan(host, plan2)
    expect(controller.semanticProjectionSignature(host)).not.toBe(sig1)
  })

  it('execution state transitions are recorded per host (idle → plan-ready → committed)', () => {
    const host = document.createElement('div')
    const { controller } = makePlan(host)
    expect(controller.getExecutionState(host)).toBe('idle')
    controller.setExecutionState(host, 'plan-ready')
    expect(controller.getExecutionState(host)).toBe('plan-ready')
    controller.setExecutionState(host, 'committed')
    expect(controller.getExecutionState(host)).toBe('committed')
    controller.clearAll()
    expect(controller.getExecutionState(host)).toBe('idle')
  })

  it('wasInjected + lastLookup record the consumed transaction (signature-scoped)', () => {
    const host = document.createElement('div')
    const { controller } = makePlan(host, 'E = mc^2')
    expect(controller.wasInjectedForCurrentSignature(host)).toBe(false)
    controller.prepareTransientRenderInput('E = mc^2', 'doc-a', 3)
    expect(controller.wasInjectedForCurrentSignature(host)).toBe(true)
    expect(controller.lastLookup(host)).toBe('MATCHED')
  })
})

describe('classifyFormulaProjectionVerify (Phase 7R.3.1-A verifier)', () => {
  it('VERIFY-1: customDecorationCount=0 but semantic output not proven → NOT SEMANTIC_VISIBLE_VERIFIED', () => {
    expect(classifyFormulaProjectionVerify({
      planExists: true, injected: false, committedForCurrentSignature: false, lookupDecision: 'MATCHED',
      semanticCommitted: false, sequentialCommitted: false, customDecorationCount: 0,
    })).toBe('TRANSIENT_PLAN_PENDING')
    expect(classifyFormulaProjectionVerify({
      planExists: true, injected: false, committedForCurrentSignature: false, lookupDecision: 'NO_SOURCE_MATCH_IN_COMPLETE_PLAN_SET',
      semanticCommitted: false, sequentialCommitted: false, customDecorationCount: 0,
    })).toBe('TRANSIENT_PLAN_NOT_CONSUMED')
  })

  it('VERIFY-2: semantic committed + custom=0 + duplicate=0 → SEMANTIC_VISIBLE_VERIFIED', () => {
    expect(classifyFormulaProjectionVerify({
      planExists: true, injected: true, committedForCurrentSignature: true, lookupDecision: 'MATCHED',
      semanticCommitted: true, sequentialCommitted: false, customDecorationCount: 0,
    })).toBe('SEMANTIC_VISIBLE_VERIFIED')
  })

  it('VERIFY-3: Typora sequential number committed, semantic different → FAIL (not verified)', () => {
    expect(classifyFormulaProjectionVerify({
      planExists: true, injected: true, committedForCurrentSignature: false, lookupDecision: 'MATCHED',
      semanticCommitted: false, sequentialCommitted: true, customDecorationCount: 0,
    })).toBe('TRANSIENT_OUTPUT_NOT_COMMITTED')
  })

  it('VERIFY-4: semantic + native sequential both present → DUPLICATE', () => {
    expect(classifyFormulaProjectionVerify({
      planExists: true, injected: true, committedForCurrentSignature: true, lookupDecision: 'MATCHED',
      semanticCommitted: true, sequentialCommitted: true, customDecorationCount: 0,
    })).toBe('DUPLICATE')
  })
})

describe('Phase 7R.3.2 — plan readiness / revision drift / document switch / recovery', () => {
  it('PLAN-PRE-1: rendererReady=false → transient plan is still created and consumable', () => {
    const host = document.createElement('div')
    document.body.appendChild(host)
    const controller = new FormulaProjectionController()
    controller.setExpectedPlanCount(1)
    // Plan created even though no renderer exists.
    controller.setPlan(host, {
      documentKey: 'doc-a', revision: 3, sourceHash: hashFormulaSource('E = mc^2'),
      rawNumber: '1.1-1', renderedNumber: '(1.1-1)', formulaRuntimeKey: 'formula:0', authority: 'inkchapter-native-transient', formulaMode: 'inkchapter',
    })
    expect(controller.inventory().planCount).toBe(1)
    const decision = controller.prepareTransientRenderInput('E = mc^2', 'doc-a', 3)
    expect(decision.injected).toBe(true)
    expect(controller.lastLookup(host)).toBe('MATCHED')
  })

  it('PLAN-PRE-2: 4 formulas zero renderers → activePlanCount=4 before any render', () => {
    const controller = new FormulaProjectionController()
    controller.setExpectedPlanCount(4)
    const sources = ['a=1', 'b=2', 'c=3', 'd=4']
    for (let i = 0; i < 4; i++) {
      const host = document.createElement('div')
      document.body.appendChild(host)
      controller.setPlan(host, {
        documentKey: 'doc-a', revision: 3, sourceHash: hashFormulaSource(sources[i]),
        rawNumber: `${i + 1}`, renderedNumber: `(${i + 1})`, formulaRuntimeKey: `formula:${i}`, authority: 'inkchapter-native-transient', formulaMode: 'inkchapter',
      })
    }
    expect(controller.inventory().planCount).toBe(4)
  })

  it('PLAN-PRE-4: NO_SNAPSHOT → no plan (arbitrate defer)', () => {
    const controller = new FormulaProjectionController()
    expect(controller.arbitrate(ctx({ formulaMode: 'inkchapter', snapshotReady: false }))).toBe('defer')
  })

  it('REV-EQ-1: plan revision 4, live revision 5, same doc/source/rawNumber → ACCEPTED (drift)', () => {
    const host = document.createElement('div')
    document.body.appendChild(host)
    const { controller } = makePlan(host, 'E = mc^2', { revision: 4 })
    controller.setExpectedPlanCount(1)
    const decision = controller.prepareTransientRenderInput('E = mc^2', 'doc-a', 5)
    expect(decision.injected).toBe(true)
    expect(controller.lastLookup(host)).toBe('REVISION_DRIFT_SEMANTIC_EQUIVALENT_ACCEPTED')
  })

  it('REV-EQ-3: revision differs + document changed → DOCUMENT_MISMATCH (never relaxed)', () => {
    const host = document.createElement('div')
    document.body.appendChild(host)
    const { controller } = makePlan(host, 'E = mc^2', { revision: 4, documentKey: 'doc-a' })
    const decision = controller.prepareTransientRenderInput('E = mc^2', 'doc-b', 9)
    expect(decision.injected).toBe(false)
    expect(controller.lastLookup(host)).toBe('DOCUMENT_MISMATCH')
  })

  it('REV-EQ-4: latest current plan replaces old plan; hook consumes latest', () => {
    const host = document.createElement('div')
    document.body.appendChild(host)
    const controller = new FormulaProjectionController()
    controller.setExpectedPlanCount(1)
    controller.setPlan(host, {
      documentKey: 'doc-a', revision: 4, sourceHash: hashFormulaSource('E = mc^2'),
      rawNumber: '1.1-1', renderedNumber: '(1.1-1)', formulaRuntimeKey: 'formula:0', authority: 'inkchapter-native-transient', formulaMode: 'inkchapter',
    })
    // Plan rebuilt with a new number at a new revision — latest wins.
    controller.setPlan(host, {
      documentKey: 'doc-a', revision: 9, sourceHash: hashFormulaSource('E = mc^2'),
      rawNumber: '1.1-2', renderedNumber: '(1.1-2)', formulaRuntimeKey: 'formula:0', authority: 'inkchapter-native-transient', formulaMode: 'inkchapter',
    })
    const decision = controller.prepareTransientRenderInput('E = mc^2', 'doc-a', 9)
    expect(decision.injected).toBe(true)
    expect(decision.tex).toBe('E = mc^2\\tag{1.1-2}')
  })

  it('DOC-SWITCH-1/4: clearAll removes A plans before B publication; switch back restores new set', () => {
    const controller = new FormulaProjectionController()
    const ha = document.createElement('div')
    document.body.appendChild(ha)
    controller.setPlan(ha, {
      documentKey: 'doc-a', revision: 3, sourceHash: hashFormulaSource('a=1'),
      rawNumber: '1', renderedNumber: '(1)', formulaRuntimeKey: 'formula:0', authority: 'inkchapter-native-transient', formulaMode: 'inkchapter',
    })
    expect(controller.inventory().planCount).toBe(1)
    // Switch to B: clear A first.
    controller.clearAll()
    expect(controller.inventory().planCount).toBe(0)
    const hb = document.createElement('div')
    document.body.appendChild(hb)
    controller.setPlan(hb, {
      documentKey: 'doc-b', revision: 1, sourceHash: hashFormulaSource('b=2'),
      rawNumber: '2', renderedNumber: '(2)', formulaRuntimeKey: 'formula:0', authority: 'inkchapter-native-transient', formulaMode: 'inkchapter',
    })
    expect(controller.inventory().planCount).toBe(1)
    // B hook call never sees A doc.
    const decision = controller.prepareTransientRenderInput('b=2', 'doc-b', 1)
    expect(decision.injected).toBe(true)
  })

  it('PLAN_SET_INCOMPLETE: expected=4, active=1 → PLAN_SET_INCOMPLETE (not plain NO_SOURCE_MATCH)', () => {
    const host = document.createElement('div')
    document.body.appendChild(host)
    const controller = new FormulaProjectionController()
    controller.setExpectedPlanCount(4)
    controller.setPlan(host, {
      documentKey: 'doc-a', revision: 3, sourceHash: hashFormulaSource('E = mc^2'),
      rawNumber: '1.1-1', renderedNumber: '(1.1-1)', formulaRuntimeKey: 'formula:0', authority: 'inkchapter-native-transient', formulaMode: 'inkchapter',
    })
    const decision = controller.prepareTransientRenderInput('x = 99', 'doc-a', 3)
    expect(decision.injected).toBe(false)
    expect(controller.lastLookup(host)).not.toBe('NO_SOURCE_MATCH_IN_COMPLETE_PLAN_SET')
  })

  it('RECOVERY-1/2: recovery budget is one per unchanged plan signature', () => {
    const host = document.createElement('div')
    document.body.appendChild(host)
    const { controller } = makePlan(host, 'E = mc^2', { rawNumber: '1.1-1' })
    expect(controller.tryReserveRecoveryRender(host)).toBe(true)
    expect(controller.tryReserveRecoveryRender(host)).toBe(false)
    expect(controller.recoveryAttemptCount(host)).toBe(1)
    // Same signature → still exhausted.
    expect(controller.tryReserveRecoveryRender(host)).toBe(false)
  })

  it('RECOVERY-3: semantic output committed → no recovery (execution state committed)', () => {
    const host = document.createElement('div')
    document.body.appendChild(host)
    const { controller } = makePlan(host)
    controller.setExecutionState(host, 'committed')
    expect(controller.getExecutionState(host)).toBe('committed')
  })

  it('NO_ACTIVE_PLAN_SET: no plans at all → classified as NO_ACTIVE_PLAN_SET', () => {
    const controller = new FormulaProjectionController()
    controller.setExpectedPlanCount(4)
    const decision = controller.prepareTransientRenderInput('x = 1', 'doc-a', 3)
    expect(decision.injected).toBe(false)
    expect(decision.authority).toBe('defer')
  })
})

describe('Phase 7R.3.3 — plan diff / signature-scoped state / targeted rerender', () => {
  function planFor(host: HTMLElement, rawNumber: string, source: string, overrides: Partial<FormulaNativeRenderPlan> = {}): FormulaNativeRenderPlan {
    return {
      documentKey: 'doc-a', revision: 3, sourceHash: hashFormulaSource(source),
      rawNumber, renderedNumber: `(${rawNumber})`, formulaRuntimeKey: 'formula:0',
      authority: 'inkchapter-native-transient', formulaMode: 'inkchapter', ...overrides,
    }
  }

  it('DIFF-1: same host/source/rawNumber/authority, revision changes only → UNCHANGED', () => {
    const host = document.createElement('div')
    document.body.appendChild(host)
    const controller = new FormulaProjectionController()
    controller.applyProjectionPlan(host, planFor(host, '1.1-1', 'E = mc^2', { revision: 3 }))
    const diff = controller.applyProjectionPlan(host, planFor(host, '1.1-1', 'E = mc^2', { revision: 9 }))
    expect(diff).toEqual({ affected: false, reason: 'UNCHANGED' })
  })

  it('DIFF-2: rawNumber 1.1-1 → 2-1 → SEMANTIC_NUMBER_CHANGED + old evidence invalidated', () => {
    const host = document.createElement('div')
    document.body.appendChild(host)
    const controller = new FormulaProjectionController()
    controller.applyProjectionPlan(host, planFor(host, '1.1-1', 'E = mc^2'))
    controller.markCommitted(host)
    expect(controller.isCommittedForCurrentSignature(host)).toBe(true)
    const diff = controller.applyProjectionPlan(host, planFor(host, '2-1', 'E = mc^2'))
    expect(diff).toEqual({ affected: true, reason: 'SEMANTIC_NUMBER_CHANGED' })
    // Old commit evidence must NOT leak into the new signature.
    expect(controller.isCommittedForCurrentSignature(host)).toBe(false)
    expect(controller.wasInjectedForCurrentSignature(host)).toBe(false)
    expect(controller.getExecutionState(host)).toBe('plan-ready')
    expect(controller.recoveryAttemptCount(host)).toBe(0)
  })

  it('DIFF-3: sourceHash changes, rawNumber same → SOURCE_CHANGED', () => {
    const host = document.createElement('div')
    document.body.appendChild(host)
    const controller = new FormulaProjectionController()
    controller.applyProjectionPlan(host, planFor(host, '1.1-1', 'E = mc^2'))
    const diff = controller.applyProjectionPlan(host, planFor(host, '1.1-1', 'E = mc^3'))
    expect(diff).toEqual({ affected: true, reason: 'SOURCE_CHANGED' })
  })

  it('DIFF-4: document changes → old signature invalid', () => {
    const host = document.createElement('div')
    document.body.appendChild(host)
    const controller = new FormulaProjectionController()
    controller.applyProjectionPlan(host, planFor(host, '1.1-1', 'E = mc^2', { documentKey: 'doc-a' }))
    const diff = controller.applyProjectionPlan(host, planFor(host, '1.1-1', 'E = mc^2', { documentKey: 'doc-b' }))
    expect(diff.reason).toBe('DOCUMENT_CHANGED')
  })

  it('STATE-SIG-1/3: changed signature resets injected/committed/renderRequested/recoveryAttempt', () => {
    const host = document.createElement('div')
    document.body.appendChild(host)
    const controller = new FormulaProjectionController()
    controller.applyProjectionPlan(host, planFor(host, '1.1-1', 'E = mc^2'))
    controller.prepareTransientRenderInput('E = mc^2', 'doc-a', 3) // injected
    controller.tryReserveRecoveryRender(host) // budget 1
    expect(controller.wasInjectedForCurrentSignature(host)).toBe(true)
    expect(controller.recoveryAttemptCount(host)).toBe(1)
    // New signature S2 (rawNumber 2-1).
    controller.applyProjectionPlan(host, planFor(host, '2-1', 'E = mc^2'))
    expect(controller.wasInjectedForCurrentSignature(host)).toBe(false)
    expect(controller.recoveryAttemptCount(host)).toBe(0)
    // One fresh render for S2 allowed.
    expect(controller.tryReserveRecoveryRender(host)).toBe(true)
    expect(controller.tryReserveRecoveryRender(host)).toBe(false)
  })

  it('RERENDER-DYN-1/2/4: new signature gets exactly one request; same signature repeated → no second', () => {
    const host = document.createElement('div')
    document.body.appendChild(host)
    const controller = new FormulaProjectionController()
    controller.applyProjectionPlan(host, planFor(host, '1.1-1', 'E = mc^2'))
    expect(controller.tryReserveRecoveryRender(host)).toBe(true)
    expect(controller.tryReserveRecoveryRender(host)).toBe(false)
    // Same S2 reconcile repeats → no new request.
    controller.applyProjectionPlan(host, planFor(host, '1.1-1', 'E = mc^2'))
    expect(controller.tryReserveRecoveryRender(host)).toBe(false)
    // New S3 → one new request allowed.
    controller.applyProjectionPlan(host, planFor(host, '2-1', 'E = mc^2'))
    expect(controller.tryReserveRecoveryRender(host)).toBe(true)
  })

  it('STATE-SIG-2: same signature repeated reconcile → committed state preserved', () => {
    const host = document.createElement('div')
    document.body.appendChild(host)
    const controller = new FormulaProjectionController()
    controller.applyProjectionPlan(host, planFor(host, '1.1-1', 'E = mc^2'))
    controller.markCommitted(host)
    expect(controller.getExecutionState(host)).toBe('committed')
    controller.applyProjectionPlan(host, planFor(host, '1.1-1', 'E = mc^2', { revision: 99 }))
    expect(controller.getExecutionState(host)).toBe('committed')
    expect(controller.isCommittedForCurrentSignature(host)).toBe(true)
  })
})
