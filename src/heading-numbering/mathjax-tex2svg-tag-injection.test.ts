// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest'
import {
  detectExplicitTagControl,
  buildInjectedTex,
  resolvePreCallAuthorization,
  buildFormulaRenderAuthorizationPlan,
  handleTex2svgPreCall,
  setTex2svgInjectionContext,
  nextPlanRevision,
  resetFrozenPlanSources,
  type FormulaRenderAuthorizationPlan,
} from './mathjax-tex2svg-tag-injection'
import { simpleHash, normalizeTexSource } from './formula-tex-source-verifier'
import { makeTransparentWrapper } from './mathjax-render-route-trace'

/**
 * Unit tests for Proven tex2svgPromise Pre-call Formula Authority +
 * Guarded Native Tag Injection (v2.5.7-R5.4).
 * Tests NEVER execute a real MathJax render and NEVER modify Markdown.
 */

function hostWithSource(tex: string): HTMLElement {
  const host = document.createElement('div')
  host.className = 'mathjax-block md-end-block md-math-block md-rawblock'
  host.textContent = `$$${tex}$$`
  return host
}

function makePlan(opts: { f0Tex: string; f1Tex: string; docKey?: string; sha?: string; desiredTags?: [string, string] }): FormulaRenderAuthorizationPlan {
  const f0Host = hostWithSource(opts.f0Tex)
  const f1Host = hostWithSource(opts.f1Tex)
  const [tag0, tag1] = opts.desiredTags ?? ['5.3.1', '11.2.1']
  return buildFormulaRenderAuthorizationPlan({
    managedFormulas: [
      { host: f0Host, formulaIndex: 0, desiredTag: tag0 },
      { host: f1Host, formulaIndex: 1, desiredTag: tag1 },
    ],
    documentKey: opts.docKey ?? 'docA',
    documentPath: 'C:/vault/a.md',
    documentSourceRevision: 2,
    documentSourceSha256: opts.sha ?? 'SHA-X',
    planRevision: nextPlanRevision(),
    generation: 2,
    editorRoot: null,
  })
}

function baseAuthInput(overrides: Record<string, unknown> = {}): any {
  const plan = makePlan({ f0Tex: 'x+y', f1Tex: 'z-w' })
  return {
    plan,
    inputTex: 'x+y',
    sameDocument: true,
    sameSourceRevision: true,
    formulaNumberingEnabled: true,
    editingHostSourceHashes: [],
    ...overrides,
  }
}

function auth(overrides: Record<string, unknown> = {}): ReturnType<typeof resolvePreCallAuthorization> {
  return resolvePreCallAuthorization(baseAuthInput(overrides))
}

describe('Authorization Plan (v2.5.7-R5.4)', () => {
  beforeEach(() => {
    setTex2svgInjectionContext(null)
    resetFrozenPlanSources()
  })

  it('plan freezes raw TeX snapshot (later visual text cannot overwrite)', () => {
    const host = hostWithSource('y=f(x)')
    const plan = buildFormulaRenderAuthorizationPlan({
      managedFormulas: [{ host, formulaIndex: 0, desiredTag: '5.3.1' }],
      documentKey: 'docA',
      documentPath: 'p',
      documentSourceRevision: 2,
      documentSourceSha256: 'SHA',
      planRevision: 1,
      generation: 2,
      editorRoot: null,
    })
    const frozenHash = plan.entries[0].normalizedSourceHash
    // Later visual text appears in the host — plan must NOT be overwritten.
    host.textContent = '(5.3.1)y=f(x) rendered output'
    const plan2 = buildFormulaRenderAuthorizationPlan({
      managedFormulas: [{ host, formulaIndex: 0, desiredTag: '5.3.1' }],
      documentKey: 'docA',
      documentPath: 'p',
      documentSourceRevision: 2,
      documentSourceSha256: 'SHA',
      planRevision: 2,
      generation: 2,
      editorRoot: null,
    })
    expect(plan2.entries[0].normalizedSourceHash).toBe(frozenHash)
    const result = resolvePreCallAuthorization({
      plan: plan2,
      inputTex: 'y=f(x)',
      sameDocument: true,
      sameSourceRevision: true,
      formulaNumberingEnabled: true,
      editingHostSourceHashes: [],
    })
    expect(result.decision).toBe('AUTHORIZED')
    expect(result.uniqueAuthorizedFormulaIndex).toBe(0)
  })

  it('26/27. stale source SHA / foreign document → PASS_THROUGH', () => {
    expect(auth({ sameSourceRevision: false }).reason).toBe('STALE_SOURCE_REVISION')
    expect(auth({ sameDocument: false }).reason).toBe('STALE_OR_FOREIGN_DOCUMENT')
  })
})

describe('Pre-call Authorization (v2.5.7-R5.4)', () => {
  beforeEach(() => {
    setTex2svgInjectionContext(null)
    resetFrozenPlanSources()
  })

  it('1. managed=true + unique exact source → AUTHORIZED', () => {
    const result = auth({ inputTex: 'x+y' })
    expect(result.decision).toBe('AUTHORIZED')
    expect(result.uniqueAuthorizedFormulaIndex).toBe(0)
    expect(result.desiredTag).toBe('5.3.1')
    expect(result.authorityKind).toBe('EXACT_NORMALIZED_SOURCE_MATCH')
  })

  it('2. managed=false (empty plan) → PASS_THROUGH', () => {
    const emptyPlan = makePlan({ f0Tex: '', f1Tex: '' })
    emptyPlan.entries = emptyPlan.entries.filter((e) => e.authorizationState === 'READY')
    const result = resolvePreCallAuthorization({
      plan: emptyPlan,
      inputTex: 'x+y',
      sameDocument: true,
      sameSourceRevision: true,
      formulaNumberingEnabled: true,
      editingHostSourceHashes: [],
    })
    expect(result.decision).toBe('PASS_THROUGH')
  })

  it('3. wrong document → PASS_THROUGH', () => {
    expect(auth({ sameDocument: false }).decision).toBe('PASS_THROUGH')
  })

  it('4. wrong source revision → PASS_THROUGH', () => {
    expect(auth({ sameSourceRevision: false }).decision).toBe('PASS_THROUGH')
  })

  it('5. desiredTag missing → PASS_THROUGH', () => {
    const plan = makePlan({ f0Tex: 'x+y', f1Tex: 'z-w', desiredTags: ['', ''] })
    const result = resolvePreCallAuthorization({
      plan,
      inputTex: 'x+y',
      sameDocument: true,
      sameSourceRevision: true,
      formulaNumberingEnabled: true,
      editingHostSourceHashes: [],
    })
    expect(result.decision).toBe('PASS_THROUGH')
    expect(result.reason).toBe('DESIRED_TAG_NOT_READY')
  })

  it('6. two formulas same source → AMBIGUOUS (BLOCK)', () => {
    const plan = makePlan({ f0Tex: 'same', f1Tex: 'same' })
    const result = resolvePreCallAuthorization({
      plan,
      inputTex: 'same',
      sameDocument: true,
      sameSourceRevision: true,
      formulaNumberingEnabled: true,
      editingHostSourceHashes: [],
    })
    expect(result.decision).toBe('BLOCK_AMBIGUOUS')
    expect(result.authorityKind).toBe('AMBIGUOUS')
  })

  it('7. current-editing-host + exact source disambiguates duplicate source', () => {
    const plan = makePlan({ f0Tex: 'same', f1Tex: 'same' })
    const hash = simpleHash(normalizeTexSource('same'))
    const result = resolvePreCallAuthorization({
      plan,
      inputTex: 'same',
      sameDocument: true,
      sameSourceRevision: true,
      formulaNumberingEnabled: true,
      editingHostSourceHashes: [hash],
    })
    expect(result.decision).toBe('AUTHORIZED')
    expect(result.authorityKind).toBe('CURRENT_EDITING_HOST_PLUS_EXACT_SOURCE_MATCH')
  })

  it('8-11. explicit tag control → PASS_THROUGH', () => {
    const plan = makePlan({ f0Tex: 'x+y', f1Tex: 'z-w' })
    for (const tex of ['x+y\\tag{1}', 'x+y\\tag*{1}', 'x+y\\notag', 'x+y\\nonumber']) {
      const result = resolvePreCallAuthorization({
        plan,
        inputTex: tex,
        sameDocument: true,
        sameSourceRevision: true,
        formulaNumberingEnabled: true,
        editingHostSourceHashes: [],
      })
      expect(result.decision).toBe('PASS_THROUGH')
      expect(result.reason).toBe('EXPLICIT_TAG_CONTROL')
    }
  })

  it('12. R^2 does not match plan → PASS_THROUGH', () => {
    const result = auth({ inputTex: 'R^2' })
    expect(result.decision).toBe('PASS_THROUGH')
    expect(result.reason).toBe('NO_FORMULA_SOURCE_MATCH')
    expect(result.foreignMathRejected).toBe(true)
  })

  it('13. unrelated display math → PASS_THROUGH', () => {
    const result = auth({ inputTex: '\\int_0^1 f(x)dx' })
    expect(result.decision).toBe('PASS_THROUGH')
  })

  it('14. formula from other document → PASS_THROUGH', () => {
    expect(auth({ sameDocument: false }).decision).toBe('PASS_THROUGH')
  })

  it('29. null generation alone cannot authorize', () => {
    const result = auth({ sameDocument: false })
    expect(result.decision).toBe('PASS_THROUGH')
    expect(result.reason).toBe('STALE_OR_FOREIGN_DOCUMENT')
  })

  it('30. formula numbering disabled → PASS_THROUGH (no injection)', () => {
    const result = auth({ formulaNumberingEnabled: false })
    expect(result.decision).toBe('PASS_THROUGH')
    expect(result.reason).toBe('FORMULA_NUMBERING_DISABLED')
  })
})

describe('Explicit Tag Control Parser (v2.5.7-R5.4)', () => {
  it('detects \\tag \\tag* \\notag \\nonumber', () => {
    expect(detectExplicitTagControl('a\\tag{1}').tagFound).toBe(true)
    expect(detectExplicitTagControl('a\\tag*{1}').tagStarFound).toBe(true)
    expect(detectExplicitTagControl('a\\notag').notagFound).toBe(true)
    expect(detectExplicitTagControl('a\\nonumber').nonumberFound).toBe(true)
    expect(detectExplicitTagControl('a\\tag{1}').decision).toBe('SKIP_EXPLICIT_TAG_CONTROL')
  })

  it('ignores escaped backslash and TeX comments', () => {
    expect(detectExplicitTagControl('a\\\\tag{1}').tagFound).toBe(false)
    expect(detectExplicitTagControl('a% comment \\tag{1}\nb').tagFound).toBe(false)
    expect(detectExplicitTagControl('plain').decision).toBe('PASS')
  })
})

describe('Injection Transformation (v2.5.7-R5.4)', () => {
  it('15/24. Formula0 input → append \\tag{5.3.1} exactly (no parentheses)', () => {
    const build = buildInjectedTex('x+y', '5.3.1')
    expect(build.injectedTex).toBe('x+y\\tag{5.3.1}')
    expect(build.tagInserted).toBe(true)
  })

  it('16. Formula1 input → append \\tag{11.2.1}', () => {
    const build = buildInjectedTex('z-w', '11.2.1')
    expect(build.injectedTex).toBe('z-w\\tag{11.2.1}')
  })

  it('25. unsupported complex structure → PASS_THROUGH', () => {
    const build = buildInjectedTex('\\begin{aligned}a\\end{aligned}', '5.3.1')
    expect(build.decision).toBe('PASS_THROUGH')
    expect(build.reason).toBe('UNSUPPORTED_COMPLEX_TEX_STRUCTURE')
  })
})

describe('Guarded Wrapper + Forwarded Args (v2.5.7-R5.4)', () => {
  beforeEach(() => {
    setTex2svgInjectionContext(null)
    resetFrozenPlanSources()
  })

  it('17-20. authorized call: original args/input unchanged, forwardedArgs is a NEW array with injected [0], identity preserved for [1..]', async () => {
    const plan = makePlan({ f0Tex: 'x+y', f1Tex: 'z-w' })
    setTex2svgInjectionContext({
      enabled: true,
      plan,
      getWorkspaceActivePath: () => 'C:/vault/a.md',
      getDocumentKey: () => 'docA',
      getDocumentSourceSha256: () => 'SHA-X',
      getEditorRoot: () => null,
      getCurrentGeneration: () => 2,
    })
    const opts = { em: 12, scale: 80 }
    const originalArgs = ['x+y', opts]
    const received: unknown[] = []
    const original = (...a: unknown[]) => { received.push(...a); return 'RET' }
    const wrapper = makeTransparentWrapper(
      original,
      () => {},
      (args, _t, _s) => {
        const r = handleTex2svgPreCall(args, null, '')
        return r.injection ? { applyArgs: r.applyArgs, injection: r.injection } : null
      },
    )
    const result = (wrapper as any)(...originalArgs)
    expect(result).toBe('RET')
    expect(received[0]).toBe('x+y\\tag{5.3.1}')
    expect(received[1]).toBe(opts)
    // Original args untouched.
    expect(originalArgs[0]).toBe('x+y')
    expect(originalArgs[1]).toBe(opts)
  })

  it('21. unauthorized call uses original args (same array identity semantics)', () => {
    setTex2svgInjectionContext({
      enabled: true,
      plan: makePlan({ f0Tex: 'x+y', f1Tex: 'z-w' }),
      getWorkspaceActivePath: () => 'C:/vault/a.md',
      getDocumentKey: () => 'docA',
      getDocumentSourceSha256: () => 'SHA-X',
      getEditorRoot: () => null,
      getCurrentGeneration: () => 2,
    })
    const originalArgs = ['R^2', {}]
    const received: unknown[] = []
    const original = (...a: unknown[]) => { received.push(...a); return 'R' }
    const wrapper = makeTransparentWrapper(original, () => {}, (args, _t, _s) => {
      const r = handleTex2svgPreCall(args, null, '')
      return r.injection ? { applyArgs: r.applyArgs, injection: r.injection } : null
    })
    expect((wrapper as any)(...originalArgs)).toBe('R')
    expect(received[0]).toBe('R^2')
  })

  it('22. authorized wrapper returns exact Reflect.apply result', () => {
    const plan = makePlan({ f0Tex: 'x+y', f1Tex: 'z-w' })
    setTex2svgInjectionContext({
      enabled: true,
      plan,
      getWorkspaceActivePath: () => 'p',
      getDocumentKey: () => 'docA',
      getDocumentSourceSha256: () => 'SHA-X',
      getEditorRoot: () => null,
      getCurrentGeneration: () => 2,
    })
    const promise = Promise.resolve('done')
    const original = () => promise
    const wrapper = makeTransparentWrapper(original, () => {}, (args, _t, _s) => {
      const r = handleTex2svgPreCall(args, null, '')
      return r.injection ? { applyArgs: r.applyArgs, injection: r.injection } : null
    })
    expect((wrapper as any)('x+y')).toBe(promise)
  })

  it('23. unauthorized wrapper returns exact Reflect.apply result', () => {
    const plan = makePlan({ f0Tex: 'x+y', f1Tex: 'z-w' })
    setTex2svgInjectionContext({
      enabled: true,
      plan,
      getWorkspaceActivePath: () => 'p',
      getDocumentKey: () => 'docA',
      getDocumentSourceSha256: () => 'SHA-X',
      getEditorRoot: () => null,
      getCurrentGeneration: () => 2,
    })
    const promise = Promise.resolve(1)
    const original = () => promise
    const wrapper = makeTransparentWrapper(original, () => {}, (args, _t, _s) => {
      const r = handleTex2svgPreCall(args, null, '')
      return r.injection ? { applyArgs: r.applyArgs, injection: r.injection } : null
    })
    expect((wrapper as any)('R^2')).toBe(promise)
  })

  it('28. plan unavailable → no injection', () => {
    setTex2svgInjectionContext({
      enabled: true,
      plan: null,
      getWorkspaceActivePath: () => 'p',
      getDocumentKey: () => 'docA',
      getDocumentSourceSha256: () => 'SHA-X',
      getEditorRoot: () => null,
      getCurrentGeneration: () => 2,
    })
    const result = handleTex2svgPreCall(['x+y'], null, '')
    expect(result.decision).toBe('PASS_THROUGH')
    expect(result.injection).toBeNull()
    expect(result.applyArgs).toBe(result.applyArgs)
  })
})
