// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest'
import {
  makeTransparentWrapper,
  installRenderRouteHooks,
  restoreRenderRouteHooks,
  classifyFormulaCorrelation,
  classifyRouteFinal,
  simpleHash,
  normalizeTex,
  setRouteTraceContext,
  setRouteTraceEditorRoot,
  filterExternalCallerFrames,
  classifyExternalCaller,
  isStrongAuthority,
  returnedNodeRoutes,
  deltaNodeRoutes,
  deltaNodeKinds,
  getRecordedRouteCalls,
  type RouteCallRecord,
  type FormulaRouteCorrelationResult,
  type FormulaRouteCorrelationInput,
  type DeltaNodeKind,
} from './mathjax-render-route-trace'

/**
 * Unit tests for MathJax Render Result + Call-Local DOM Delta + External
 * Caller Authority (v2.5.7-R5.3.1).
 *
 * Validates the original-thenable fulfillment observer, deep-shape probe,
 * call-local DOM delta identity, overlap gating, external caller filtering,
 * formula source verifier integration, and the final authority gate.
 * Tests NEVER execute a real MathJax render.
 */

function makeRecord(overrides: Partial<RouteCallRecord> = {}): RouteCallRecord {
  return {
    routeName: 'MathJax.tex2svgPromise',
    ownerName: 'MathJax',
    tier: 1,
    callOrdinal: 1,
    timestamp: Date.now(),
    documentKey: null,
    documentGeneration: null,
    renderWindowId: 'rw-test',
    argCount: 1,
    inputString: 'x+y',
    inputHash: simpleHash(normalizeTex('x+y')),
    inputLength: 3,
    inputPrefix: 'x+y',
    displayOption: null,
    optionsSummary: {},
    stackTop: [],
    stackHash: '',
    callerFrames: [],
    externalCallerFrame: null,
    externalCallerSourceKind: 'UNKNOWN',
    fulfillmentNodes: [],
    fulfillmentUndefined: false,
    fulfillmentNodeLike: false,
    deltaNodes: [],
    removedNodes: [],
    deltaKind: null,
    mathBlocks: [],
    beforeMjxCounts: new Map(),
    afterMjxCounts: new Map(),
    activeCallCountAtStart: 0,
    maxConcurrentCallCount: 1,
    overlapDetected: false,
    observerDisconnected: true,
    settled: true,
    returnedNodeCount: 0,
    ...overrides,
  }
}

function correlate(input: Partial<FormulaRouteCorrelationInput>): FormulaRouteCorrelationResult {
  return classifyFormulaCorrelation({
    formulaIndex: 0,
    formulaHostToken: 1,
    desiredTag: '5.3.1',
    host: document.createElement('div'),
    formulaTex: '',
    formulaSourceKind: 'UNAVAILABLE',
    documentKey: 'docA',
    documentGeneration: 2,
    records: [],
    returnedNodeRoutesMap: new WeakMap<Node, RouteCallRecord>(),
    deltaNodeRoutesMap: new WeakMap<Node, RouteCallRecord>(),
    deltaNodeKindsMap: new WeakMap<Node, DeltaNodeKind>(),
    ...input,
  })
}

function makeHostWithMjx(): { host: HTMLElement; mjx: HTMLElement } {
  const host = document.createElement('div')
  const mjx = document.createElement('mjx-container')
  host.appendChild(mjx)
  return { host, mjx }
}

async function flush(): Promise<void> {
  await new Promise((r) => setTimeout(r, 0))
}

describe('Transparent Wrapper Hard Contract (v2.5.7-R5.3.1)', () => {
  it('wrapper preserves this / args / sync return / Promise identity / thrown Error', () => {
    const original = function (this: any, a: unknown) { return { prefix: this.prefix, a } }
    const wrapper = makeTransparentWrapper(original, () => {})
    const ctx = { prefix: 'P' }
    const obj = { k: 1 }
    const out = (wrapper as any).call(ctx, obj)
    expect(out.prefix).toBe('P')
    expect(out.a).toBe(obj)

    const promise = Promise.resolve(1)
    const wrapper2 = makeTransparentWrapper(() => promise, () => {})
    expect(wrapper2()).toBe(promise)

    const err = new Error('x')
    const wrapper3 = makeTransparentWrapper(() => { throw err }, () => {})
    expect(() => wrapper3()).toThrow(err)
  })

  it('wrapper captures pre-call stack and passes it to observer', () => {
    let captured = ''
    const wrapper = makeTransparentWrapper(() => 1, (_r, _t, _a, stack) => { captured = stack })
    wrapper()
    expect(captured).toContain('at ')
  })
})

describe('Hook Install / Restore Lifecycle (v2.5.7-R5.3.1)', () => {
  const originalTex2svgPromise = (tex: string) => Promise.resolve(undefined)

  beforeEach(() => {
    restoreRenderRouteHooks()
    delete (window as any).MathJax
    setRouteTraceEditorRoot(null)
  })

  function installFakeMathJax(): void {
    (window as any).MathJax = {
      tex2svg: () => document.createElement('div'),
      tex2svgPromise: originalTex2svgPromise,
      tex2chtml: () => document.createElement('div'),
      tex2chtmlPromise: () => Promise.resolve(document.createElement('div')),
      typeset: () => {},
      typesetPromise: () => Promise.resolve(),
      startup: {
        document: {
          convert: () => document.createElement('div'),
          render: () => Promise.resolve(),
          rerender: () => Promise.resolve(),
          compile: () => ({}),
          typeset: () => {},
          updateDocument: () => Promise.resolve(),
        },
        input: [{ compile: () => ({}) }],
        output: { typeset: () => {} },
      },
    }
  }

  it('installationCount remains 1 (idempotent)', () => {
    installFakeMathJax()
    installRenderRouteHooks()
    const first = (window as any).MathJax.tex2svgPromise
    installRenderRouteHooks()
    expect((window as any).MathJax.tex2svgPromise).toBe(first)
  })

  it('restore restores original function reference', () => {
    installFakeMathJax()
    installRenderRouteHooks()
    expect((window as any).MathJax.tex2svgPromise).not.toBe(originalTex2svgPromise)
    restoreRenderRouteHooks()
    expect((window as any).MathJax.tex2svgPromise).toBe(originalTex2svgPromise)
  })
})

describe('Promise / Thenable Fulfillment Authority (v2.5.7-R5.3.1)', () => {
  beforeEach(() => {
    restoreRenderRouteHooks()
    delete (window as any).MathJax
    setRouteTraceEditorRoot(null)
  })

  it('1. native Promise fulfillment observer registers the node', async () => {
    const node = document.createElement('mjx-container')
    let resolveFn!: (v: unknown) => void
    (window as any).MathJax = {
      tex2svgPromise: () => new Promise((resolve) => { resolveFn = resolve }),
      startup: { document: {} },
    }
    installRenderRouteHooks()
    const before = getRecordedRouteCalls().length
    const ret = (window as any).MathJax.tex2svgPromise('x+y')
    resolveFn(node)
    await flush()
    const rec = getRecordedRouteCalls()[before]
    expect(rec.fulfillmentNodeLike).toBe(true)
    expect(rec.fulfillmentNodes).toContain(node)
    expect(returnedNodeRoutes.get(node)).toBe(rec)
    expect(ret instanceof Promise).toBe(true)
  })

  it('2. custom thenable fulfillment observer (Reflect.apply on original then)', async () => {
    const node = document.createElement('mjx-container')
    const thenable = {
      then(resolve: (v: unknown) => void) { resolve(node); return undefined },
    }
    // Exercise through the full hook path.
    ;(window as any).MathJax = {
      tex2svgPromise: () => thenable,
      startup: { document: {} },
    }
    installRenderRouteHooks()
    const before = getRecordedRouteCalls().length
    const ret = (window as any).MathJax.tex2svgPromise('x+y')
    await flush()
    const rec = getRecordedRouteCalls()[before]
    expect(rec.fulfillmentNodes).toContain(node)
    expect(ret).toBe(thenable)
  })

  it('3. original Promise/thenable identity preserved', async () => {
    const promise = Promise.resolve(undefined)
    ;(window as any).MathJax = { tex2svgPromise: () => promise, startup: { document: {} } }
    installRenderRouteHooks()
    const ret = (window as any).MathJax.tex2svgPromise('x')
    expect(ret).toBe(promise)
    await flush()
  })

  it('4. fulfillment undefined classification', async () => {
    ;(window as any).MathJax = { tex2svgPromise: () => Promise.resolve(undefined), startup: { document: {} } }
    installRenderRouteHooks()
    const before = getRecordedRouteCalls().length
    await (window as any).MathJax.tex2svgPromise('x')
    await flush()
    const rec = getRecordedRouteCalls()[before]
    expect(rec.fulfillmentUndefined).toBe(true)
    expect(rec.fulfillmentNodeLike).toBe(false)
    expect(rec.fulfillmentNodes.length).toBe(0)
  })

  it('5. cross-realm-like node: instanceof=false but nodeLike=true (structural)', async () => {
    const fakeNode = { nodeType: 1, nodeName: 'DIV' }
    ;(window as any).MathJax = { tex2svgPromise: () => Promise.resolve(fakeNode), startup: { document: {} } }
    installRenderRouteHooks()
    const before = getRecordedRouteCalls().length
    await (window as any).MathJax.tex2svgPromise('x')
    await flush()
    const rec = getRecordedRouteCalls()[before]
    expect(rec.fulfillmentNodeLike).toBe(true)
    expect(fakeNode instanceof Node).toBe(false)
    expect(returnedNodeRoutes.has(fakeNode as unknown as Node)).toBe(true)
  })
})

describe('Call-Local DOM Delta Identity (v2.5.7-R5.3.1)', () => {
  beforeEach(() => {
    restoreRenderRouteHooks()
    delete (window as any).MathJax
  })

  it('7. call-local added mjx node → CALL_LOCAL_DOM_DELTA_IDENTITY strong', async () => {
    const root = document.createElement('div')
    document.body.appendChild(root)
    setRouteTraceEditorRoot(root)
    const host = document.createElement('div')
    host.className = 'md-math-block mathjax-block'
    root.appendChild(host)
    const mjx = document.createElement('mjx-container')
    // Production MathJax inserts the container asynchronously (after the
    // promise settles) — the call-local observer, installed synchronously
    // after the intercepted call, must capture it.
    ;(window as any).MathJax = {
      tex2svgPromise: () => new Promise((resolve) => {
        queueMicrotask(() => {
          host.appendChild(mjx)
          queueMicrotask(() => resolve(undefined))
        })
      }),
      startup: { document: {} },
    }
    installRenderRouteHooks()
    const before = getRecordedRouteCalls().length
    await (window as any).MathJax.tex2svgPromise('x+y')
    await flush()
    const rec = getRecordedRouteCalls()[before]
    expect(rec.deltaNodes).toContain(mjx)
    expect(deltaNodeKinds.get(mjx)).toBe('ADDED')
    const result = correlate({
      host,
      records: [rec],
      returnedNodeRoutesMap: new WeakMap<Node, RouteCallRecord>(),
      deltaNodeRoutesMap: deltaNodeRoutes,
      deltaNodeKindsMap: deltaNodeKinds,
    })
    expect(result.callLocalDomDeltaMatchCount).toBeGreaterThan(0)
    expect(result.strongestAuthority).toBe('CALL_LOCAL_DOM_DELTA_IDENTITY')
    expect(result.strongAuthority).toBe(true)
    expect(result.decision).toBe('PASS')
    expect(rec.observerDisconnected).toBe(true)
    document.body.removeChild(root)
    setRouteTraceEditorRoot(null)
  })

  it('8. call-local replacement → CALL_LOCAL_DOM_REPLACEMENT_IDENTITY strong', () => {
    const { host, mjx } = makeHostWithMjx()
    const record = makeRecord({ documentKey: 'docA', documentGeneration: 2, deltaKind: 'REPLACED' as const })
    const dMap = new WeakMap<Node, RouteCallRecord>()
    const kMap = new WeakMap<Node, DeltaNodeKind>()
    dMap.set(mjx, record)
    kMap.set(mjx, 'REPLACED')
    const result = correlate({
      host,
      records: [record],
      returnedNodeRoutesMap: new WeakMap<Node, RouteCallRecord>(),
      deltaNodeRoutesMap: dMap,
      deltaNodeKindsMap: kMap,
    })
    expect(result.callLocalDomReplacementMatchCount).toBeGreaterThan(0)
    expect(result.strongestAuthority).toBe('CALL_LOCAL_DOM_REPLACEMENT_IDENTITY')
    expect(result.strongAuthority).toBe(true)
  })

  it('9. call-local subtree → CALL_LOCAL_SUBTREE_IDENTITY strong', () => {
    const host = document.createElement('div')
    const mjx = document.createElement('mjx-container')
    const svg = document.createElement('svg')
    mjx.appendChild(svg)
    host.appendChild(mjx)
    const record = makeRecord({ documentKey: 'docA', documentGeneration: 2 })
    const dMap = new WeakMap<Node, RouteCallRecord>()
    const kMap = new WeakMap<Node, DeltaNodeKind>()
    dMap.set(svg, record)
    kMap.set(svg, 'SUBTREE')
    const result = correlate({
      host,
      records: [record],
      returnedNodeRoutesMap: new WeakMap<Node, RouteCallRecord>(),
      deltaNodeRoutesMap: dMap,
      deltaNodeKindsMap: kMap,
    })
    expect(result.callLocalSubtreeMatchCount).toBeGreaterThan(0)
    expect(result.strongestAuthority).toBe('CALL_LOCAL_SUBTREE_IDENTITY')
    expect(result.strongAuthority).toBe(true)
  })

  it('10. overlapping call windows → DOM delta NOT strong', () => {
    const { host, mjx } = makeHostWithMjx()
    const record = makeRecord({
      documentKey: 'docA',
      documentGeneration: 2,
      overlapDetected: true,
      activeCallCountAtStart: 1,
    })
    const dMap = new WeakMap<Node, RouteCallRecord>()
    const kMap = new WeakMap<Node, DeltaNodeKind>()
    dMap.set(mjx, record)
    kMap.set(mjx, 'ADDED')
    const result = correlate({
      host,
      records: [record],
      returnedNodeRoutesMap: new WeakMap<Node, RouteCallRecord>(),
      deltaNodeRoutesMap: dMap,
      deltaNodeKindsMap: kMap,
    })
    expect(result.callWindowOverlapCount).toBeGreaterThan(0)
    expect(result.strongestAuthority).toBe('NONE')
    expect(result.strongAuthority).toBe(false)
  })

  it('11. observer always disconnects after settle', async () => {
    const root = document.createElement('div')
    document.body.appendChild(root)
    setRouteTraceEditorRoot(root)
    ;(window as any).MathJax = {
      tex2svgPromise: () => Promise.resolve(undefined),
      startup: { document: {} },
    }
    installRenderRouteHooks()
    const before = getRecordedRouteCalls().length
    await (window as any).MathJax.tex2svgPromise('x')
    await flush()
    const rec = getRecordedRouteCalls()[before]
    expect(rec.observerDisconnected).toBe(true)
    expect(rec.settled).toBe(true)
    document.body.removeChild(root)
    setRouteTraceEditorRoot(null)
  })
})

describe('Correlation Authority (v2.5.7-R5.3.1)', () => {
  it('6. exact fulfillment node → EXACT_FULFILLMENT_NODE_IDENTITY strong PASS', () => {
    const { host, mjx } = makeHostWithMjx()
    const record = makeRecord({ documentKey: 'docA', documentGeneration: 2 })
    const fMap = new WeakMap<Node, RouteCallRecord>()
    fMap.set(mjx, record)
    const result = correlate({
      host,
      formulaTex: 'x+y',
      documentKey: 'docA',
      documentGeneration: 2,
      records: [record],
      returnedNodeRoutesMap: fMap,
      deltaNodeRoutesMap: new WeakMap<Node, RouteCallRecord>(),
      deltaNodeKindsMap: new WeakMap<Node, DeltaNodeKind>(),
    })
    expect(result.fulfillmentNodeMatchCount).toBe(1)
    expect(result.strongestAuthority).toBe('EXACT_FULFILLMENT_NODE_IDENTITY')
    expect(result.strongAuthority).toBe(true)
    expect(result.decision).toBe('PASS')
  })

  it('16. hash-only correlation → PROVISIONAL (never strong)', () => {
    const { host } = makeHostWithMjx()
    const record = makeRecord({ documentKey: 'docA', documentGeneration: 2 })
    const result = correlate({
      host,
      formulaTex: 'x+y',
      formulaSourceKind: 'SAFE_HOST_TEXT_SOURCE_SEGMENT',
      documentKey: 'docA',
      documentGeneration: 2,
      records: [record],
      returnedNodeRoutesMap: new WeakMap<Node, RouteCallRecord>(),
      deltaNodeRoutesMap: new WeakMap<Node, RouteCallRecord>(),
      deltaNodeKindsMap: new WeakMap<Node, DeltaNodeKind>(),
    })
    expect(result.inputHashVerifierMatchCount).toBe(1)
    expect(result.strongestAuthority).toBe('CALL_PLUS_INPUT_HASH_VERIFIER')
    expect(result.strongAuthority).toBe(false)
    expect(result.decision).toBe('PROVISIONAL')
  })

  it('20. stale documentGeneration cannot correlate', () => {
    const { host } = makeHostWithMjx()
    const stale = makeRecord({ documentKey: 'docA', documentGeneration: 1 })
    const result = correlate({
      host,
      formulaTex: 'x+y',
      documentKey: 'docA',
      documentGeneration: 2,
      records: [stale],
      returnedNodeRoutesMap: new WeakMap<Node, RouteCallRecord>(),
      deltaNodeRoutesMap: new WeakMap<Node, RouteCallRecord>(),
      deltaNodeKindsMap: new WeakMap<Node, DeltaNodeKind>(),
    })
    expect(result.inputHashVerifierMatchCount).toBe(0)
    expect(result.actualCallCaptured).toBe(false)
    expect(result.strongestAuthority).toBe('NONE')
  })

  it('no-call candidate cannot be declared route', () => {
    const { host } = makeHostWithMjx()
    const result = correlate({
      host,
      documentKey: 'docA',
      documentGeneration: 2,
      records: [],
      returnedNodeRoutesMap: new WeakMap<Node, RouteCallRecord>(),
      deltaNodeRoutesMap: new WeakMap<Node, RouteCallRecord>(),
      deltaNodeKindsMap: new WeakMap<Node, DeltaNodeKind>(),
    })
    expect(result.strongestAuthority).toBe('NONE')
    expect(result.decision).toBe('FAIL')
    expect(result.routeName).toBeNull()
  })

  it('13/14. external caller kinds propagate to correlation', () => {
    const { host, mjx } = makeHostWithMjx()
    const record = makeRecord({
      documentKey: 'docA',
      documentGeneration: 2,
      externalCallerSourceKind: 'TYPORA_RENDERER_SCRIPT',
    })
    const fMap = new WeakMap<Node, RouteCallRecord>()
    fMap.set(mjx, record)
    const result = correlate({
      host,
      documentKey: 'docA',
      documentGeneration: 2,
      records: [record],
      returnedNodeRoutesMap: fMap,
      deltaNodeRoutesMap: new WeakMap<Node, RouteCallRecord>(),
      deltaNodeKindsMap: new WeakMap<Node, DeltaNodeKind>(),
    })
    expect(result.externalCallerSourceKind).toBe('TYPORA_RENDERER_SCRIPT')
    expect(result.externalCallerObserved).toBe(true)
  })
})

describe('External Caller Filtering (v2.5.7-R5.3.1)', () => {
  it('12. filters wrapper/audit frames, keeps real caller', () => {
    const filtered = filterExternalCallerFrames([
      'at transparentWrapper (main.js:1:1)',
      'at observeRouteCall (main.js:1:1)',
      'at realCaller (file:///C:/Typora/resources/app/renderer.js:1:1)',
    ])
    expect(filtered.filteredFrameCount).toBe(1)
    expect(filtered.wrapperFrameCount).toBe(2)
    expect(filtered.externalCallerFrame).toContain('realCaller')
  })

  it('13. Typora renderer frame classification', () => {
    const result = classifyExternalCaller(['at fn (file:///C:/Program Files/Typora/resources/app/renderer.js:1:1)'])
    expect(result.sourceKind).toBe('TYPORA_RENDERER_SCRIPT')
    expect(result.observed).toBe(true)
  })

  it('14. InkChapter business caller classification', () => {
    const result = classifyExternalCaller(['at fn (file:///D:/TyporaPluginProjects/typora-plugin-inkchapter/test/vault/.typora/plugins/dist/main.js:1:1)'])
    expect(result.sourceKind).toBe('INKCHAPTER_BUSINESS_CALLER')
    expect(result.observed).toBe(true)
  })
})

describe('Final Route Classification (v2.5.7-R5.3.1)', () => {
  const baseFormula = (overrides: Partial<FormulaRouteCorrelationResult> = {}): FormulaRouteCorrelationResult => ({
    formulaIndex: 0,
    formulaHostToken: 1,
    desiredTag: '5.3.1',
    formulaTexHash: simpleHash(normalizeTex('x+y')),
    formulaTexLength: 3,
    visibleMjxContainerCount: 1,
    actualCallCaptured: true,
    routeName: 'MathJax.tex2svgPromise',
    routeTier: 1,
    fulfillmentNodeMatchCount: 1,
    fulfillmentSubtreeMatchCount: 0,
    callLocalDomDeltaMatchCount: 0,
    callLocalDomReplacementMatchCount: 0,
    callLocalSubtreeMatchCount: 0,
    hostContainsFulfillmentNodeCount: 1,
    hostContainsFulfillmentDescendantCount: 0,
    callWindowOverlapCount: 0,
    inputHashVerifierMatchCount: 1,
    correlatedRouteCount: 1,
    correlatedRouteNames: ['MathJax.tex2svgPromise'],
    strongestAuthority: 'EXACT_FULFILLMENT_NODE_IDENTITY',
    strongAuthority: true,
    externalCallerSourceKind: 'TYPORA_RENDERER_SCRIPT',
    externalCallerObserved: true,
    formulaSourceVerifierReady: true,
    decision: 'PASS',
    reason: null,
    ...overrides,
  })

  const baseFinalInput = {
    publicApiObservedCallCount: 2,
    startupDocumentObservedCallCount: 0,
    inputJaxObservedCallCount: 0,
    outputJaxObservedCallCount: 0,
    hookInstallTimestamp: 1000,
    earliestRouteCallTimestamp: 2000,
    hookAuthorityAvailable: true,
    fulfillmentUndefinedCount: 2,
    fulfillmentNodeLikeCount: 0,
    callLocalDomDeltaCount: 0,
    callWindowOverlapCount: 0,
    selfRenderCallDetected: false,
  }

  it('17. both formulas strong same route → PASS + PUBLIC_MATHJAX_RENDER_ROUTE_PROVEN', () => {
    const f0 = baseFormula()
    const f1 = baseFormula({ formulaIndex: 1, desiredTag: '11.2.1' })
    const final = classifyRouteFinal({ formula0: f0, formula1: f1, ...baseFinalInput })
    expect(final.decision).toBe('PASS')
    expect(final.routeCase).toBe('A')
    expect(final.classification).toBe('PUBLIC_MATHJAX_RENDER_ROUTE_PROVEN')
    expect(final.specificTyporaRenderRoute).toBe('MathJax.tex2svgPromise')
    expect(final.hookInstalledBeforeEarliestCapturedCall).toBe(true)
  })

  it('18. f0 strong + f1 hash-only → PARTIAL', () => {
    const f0 = baseFormula()
    const f1 = baseFormula({
      formulaIndex: 1,
      desiredTag: '11.2.1',
      routeName: 'MathJax.tex2svgPromise',
      routeTier: 1,
      strongestAuthority: 'CALL_PLUS_INPUT_HASH_VERIFIER',
      strongAuthority: false,
      decision: 'PROVISIONAL',
      fulfillmentNodeMatchCount: 0,
      hostContainsFulfillmentNodeCount: 0,
    })
    const final = classifyRouteFinal({ formula0: f0, formula1: f1, ...baseFinalInput })
    expect(final.decision).toBe('PARTIAL')
    expect(final.specificTyporaRenderRoute).toBe('NOT_DETERMINED')
  })

  it('19. route divergence → not PASS', () => {
    const f0 = baseFormula()
    const f1 = baseFormula({
      formulaIndex: 1,
      desiredTag: '11.2.1',
      routeName: 'MathJax.startup.document.convert',
      routeTier: 2,
      correlatedRouteNames: ['MathJax.startup.document.convert'],
    })
    const final = classifyRouteFinal({ formula0: f0, formula1: f1, ...baseFinalInput })
    expect(final.decision).not.toBe('PASS')
    expect(final.routeCase).toBe('E')
  })

  it('self-render call → BLOCK INKCHAPTER_SELF_RENDER_CALL_DETECTED', () => {
    const f0 = baseFormula()
    const f1 = baseFormula({ formulaIndex: 1, desiredTag: '11.2.1' })
    const final = classifyRouteFinal({
      formula0: f0,
      formula1: f1,
      ...baseFinalInput,
      selfRenderCallDetected: true,
    })
    expect(final.decision).toBe('BLOCK')
    expect(final.classification).toBe('INKCHAPTER_SELF_RENDER_CALL_DETECTED')
  })

  it('no calls at all → regression guard (D / PASS with no-call reason)', () => {
    const f0 = baseFormula({ strongestAuthority: 'NONE', strongAuthority: false, decision: 'FAIL', routeName: null, routeTier: null })
    const f1 = baseFormula({ formulaIndex: 1, desiredTag: '11.2.1', strongestAuthority: 'NONE', strongAuthority: false, decision: 'FAIL', routeName: null, routeTier: null })
    const final = classifyRouteFinal({
      formula0: f0,
      formula1: f1,
      ...baseFinalInput,
      publicApiObservedCallCount: 0,
      startupDocumentObservedCallCount: 0,
      inputJaxObservedCallCount: 0,
      outputJaxObservedCallCount: 0,
    })
    expect(final.decision).toBe('PASS')
    expect(final.reason).toBe('NO_HOOKED_SURFACE_CALLED')
  })
})
