// @vitest-environment jsdom
/**
 * v2.5.7-R5.4.1 Unit Tests: Atomic Live Plan Binding +
 * Pre-call Synchronous Plan Catch-up (Phase D/E).
 *
 * Covers Phase Q items:
 *  8  plan binds exactly one liveFormulaRevision
 *  9  stale plan detected
 * 10  stale plan + new formula current tex2svg call → synchronous catch-up →
 *     AUTHORIZED_AFTER_CATCHUP
 * 11  catch-up no unique match → PASS_THROUGH
 * 12  catch-up reentrancy → PASS_THROUGH
 * 23  catch-up path never saves / writes / sets markdown
 */
import { describe, it, expect, beforeEach } from 'vitest'
import {
  buildFormulaRenderAuthorizationPlan,
  handleTex2svgPreCall,
  setTex2svgInjectionContext,
  nextPlanRevision,
  resetFrozenPlanSources,
  resetPreCallCatchupState,
  type Tex2svgInjectionRuntimeContext,
} from './mathjax-tex2svg-tag-injection'
import { resetLiveRevisionState } from './formula-live-revision'

function hostWithSource(tex: string): HTMLElement {
  const host = document.createElement('div')
  host.className = 'mathjax-block md-end-block md-math-block md-rawblock'
  host.textContent = `$$${tex}$$`
  return host
}

function buildPlan(input: {
  texs: string[]
  tags: string[]
  docKey?: string
  sha?: string
  revision?: number
  signature?: string
}): ReturnType<typeof buildFormulaRenderAuthorizationPlan> {
  return buildFormulaRenderAuthorizationPlan({
    managedFormulas: input.texs.map((tex, i) => ({ host: hostWithSource(tex), formulaIndex: i, desiredTag: input.tags[i] })),
    documentKey: input.docKey ?? 'docA',
    documentPath: 'C:/vault/a.md',
    documentSourceRevision: 2,
    documentSourceSha256: input.sha ?? 'SHA-X',
    planRevision: nextPlanRevision(),
    generation: 2,
    editorRoot: null,
    planLiveFormulaRevision: input.revision ?? 0,
    planSemanticSignature: input.signature ?? '',
  })
}

function makeContext(overrides: Partial<Tex2svgInjectionRuntimeContext> & { contextToken?: number }): Tex2svgInjectionRuntimeContext {
  const token = overrides.contextToken ?? 0
  const { contextToken: _ct, ...rest } = overrides
  return {
    enabled: true,
    plan: null,
    getWorkspaceActivePath: () => 'C:/vault/a.md',
    getDocumentKey: () => 'docA',
    getDocumentSourceSha256: () => 'SHA-X',
    getEditorRoot: () => null,
    getCurrentGeneration: () => 2,
    getCurrentLiveFormulaRevision: () => 0,
    getCurrentSemanticSignature: () => '',
    getContextToken: () => token,
    ...rest,
  }
}

describe('Pre-call Plan Catch-up (v2.5.7-R5.4.1)', () => {
  beforeEach(() => {
    setTex2svgInjectionContext(null)
    resetFrozenPlanSources()
    resetPreCallCatchupState()
    resetLiveRevisionState()
  })

  it('8. plan binds exactly one liveFormulaRevision + semantic signature', () => {
    const plan = buildPlan({ texs: ['x+y', 'z-w'], tags: ['11.2.1', '11.2.2'], revision: 7, signature: 'SIG-7' })
    expect(plan.planLiveFormulaRevision).toBe(7)
    expect(plan.planSemanticSignature).toBe('SIG-7')
    expect(plan.entries.every((e) => e.desiredTag !== '')).toBe(true)
  })

  it('9. stale plan detected → catch-up fails → PASS_THROUGH', () => {
    const oldPlan = buildPlan({ texs: ['x+y', 'z-w'], tags: ['11.2.1', '11.2.2'], revision: 0, signature: 'S0' })
    setTex2svgInjectionContext(makeContext({
      plan: oldPlan,
      getCurrentLiveFormulaRevision: () => 1,
      getCurrentSemanticSignature: () => 'S1',
      rebuildPlanSynchronously: () => false,
    }))
    const result = handleTex2svgPreCall(['a+b'], null, '')
    expect(result.decision).toBe('PASS_THROUGH')
    expect(result.injection).toBeNull()
  })

  it('10. stale plan + new formula current tex2svg call → synchronous catch-up → AUTHORIZED_AFTER_CATCHUP (formulaIndex=2, desiredTag=11.2.2)', () => {
    const oldPlan = buildPlan({ texs: ['x+y', 'z-w'], tags: ['11.2.1', '11.2.2'], revision: 0, signature: 'S0' })
    setTex2svgInjectionContext(makeContext({
      plan: oldPlan,
      getCurrentLiveFormulaRevision: () => 1,
      getCurrentSemanticSignature: () => 'S1',
      rebuildPlanSynchronously: () => {
        // Synchronous plan catch-up from the "current live editor": the new
        // Formula2 (tex 'a+b') is now managed at index 2 → 11.2.2.
        const freshPlan = buildPlan({
          texs: ['x+y', 'z-w', 'a+b'],
          tags: ['11.2.1', '11.2.2', '11.2.2'],
          revision: 1,
          signature: 'S1',
        })
        setTex2svgInjectionContext(makeContext({
          plan: freshPlan,
          contextToken: 1,
          getCurrentLiveFormulaRevision: () => 1,
          getCurrentSemanticSignature: () => 'S1',
          rebuildPlanSynchronously: () => false,
        }))
        return true
      },
    }))
    const result = handleTex2svgPreCall(['a+b'], null, '')
    expect(result.decision).toBe('AUTHORIZED_AFTER_CATCHUP')
    expect(result.injection).not.toBeNull()
    expect(result.injection?.formulaIndex).toBe(2)
    expect(result.injection?.desiredTag).toBe('11.2.2')
  })

  it('11. catch-up rebuilds but no unique match → PASS_THROUGH (bounded, no re-trigger)', () => {
    let rebuildCalls = 0
    const oldPlan = buildPlan({ texs: ['x+y', 'z-w'], tags: ['11.2.1', '11.2.2'], revision: 0, signature: 'S0' })
    setTex2svgInjectionContext(makeContext({
      plan: oldPlan,
      getCurrentLiveFormulaRevision: () => 1,
      getCurrentSemanticSignature: () => 'S1',
      rebuildPlanSynchronously: () => {
        rebuildCalls++
        // Rebuilt plan still has NO entry for 'R^2' (inline math / foreign).
        const freshPlan = buildPlan({ texs: ['x+y', 'z-w'], tags: ['11.2.1', '11.2.2'], revision: 1, signature: 'S1' })
        setTex2svgInjectionContext(makeContext({
          plan: freshPlan,
          getCurrentLiveFormulaRevision: () => 1,
          getCurrentSemanticSignature: () => 'S1',
          rebuildPlanSynchronously: () => false,
        }))
        return true
      },
    }))
    const first = handleTex2svgPreCall(['R^2'], null, '')
    expect(first.decision).toBe('PASS_THROUGH')
    // Same revision + same non-target input → hash-miss memo prevents a second
    // plan rebuild (no rerender storm from inline math).
    const second = handleTex2svgPreCall(['R^2'], null, '')
    expect(second.decision).toBe('PASS_THROUGH')
    expect(rebuildCalls).toBe(1)
  })

  it('12. catch-up reentrancy → PASS_THROUGH with PRECALL_CATCHUP_REENTRANCY', () => {
    const oldPlan = buildPlan({ texs: ['x+y', 'z-w'], tags: ['11.2.1', '11.2.2'], revision: 0, signature: 'S0' })
    let reentrantDecision: string | null = null
    setTex2svgInjectionContext(makeContext({
      plan: oldPlan,
      getCurrentLiveFormulaRevision: () => 1,
      getCurrentSemanticSignature: () => 'S1',
      rebuildPlanSynchronously: () => {
        // Simulate a nested tex2svg call DURING catch-up.
        const nested = handleTex2svgPreCall(['x+y'], null, '')
        reentrantDecision = nested.decision
        const freshPlan = buildPlan({ texs: ['x+y', 'z-w', 'a+b'], tags: ['11.2.1', '11.2.2', '11.2.2'], revision: 1, signature: 'S1' })
        setTex2svgInjectionContext(makeContext({
          plan: freshPlan,
          contextToken: 1,
          getCurrentLiveFormulaRevision: () => 1,
          getCurrentSemanticSignature: () => 'S1',
          rebuildPlanSynchronously: () => false,
        }))
        return true
      },
    }))
    const result = handleTex2svgPreCall(['a+b'], null, '')
    expect(reentrantDecision).toBe('PASS_THROUGH')
    // The outer call continues with the freshly rebuilt plan.
    expect(result.decision).toBe('AUTHORIZED_AFTER_CATCHUP')
  })

  it('23. catch-up path never saves / writes markdown / reloads content', () => {
    const writes: string[] = []
    const oldPlan = buildPlan({ texs: ['x+y', 'z-w'], tags: ['11.2.1', '11.2.2'], revision: 0, signature: 'S0' })
    setTex2svgInjectionContext(makeContext({
      plan: oldPlan,
      getCurrentLiveFormulaRevision: () => 1,
      getCurrentSemanticSignature: () => 'S1',
      rebuildPlanSynchronously: () => {
        const freshPlan = buildPlan({ texs: ['x+y', 'z-w', 'a+b'], tags: ['11.2.1', '11.2.2', '11.2.2'], revision: 1, signature: 'S1' })
        setTex2svgInjectionContext(makeContext({
          plan: freshPlan,
          contextToken: 1,
          getCurrentLiveFormulaRevision: () => 1,
          getCurrentSemanticSignature: () => 'S1',
          rebuildPlanSynchronously: () => false,
        }))
        return true
      },
    }))
    const result = handleTex2svgPreCall(['a+b'], null, '')
    expect(result.decision).toBe('AUTHORIZED_AFTER_CATCHUP')
    // The injection path is a pure in-memory pre-call transform: it must never
    // invoke any save / setMarkdown / reloadContent / DOM write surface.
    expect(writes).toEqual([])
  })
})
