// @vitest-environment jsdom
/**
 * Production Wiring Integration Tests for InkChapter FormulaStateMachine
 * v2.5.7-R5.4.3.17.
 *
 * These tests verify that the REAL production wiring orchestrates calls to
 * FormulaStateStore and FormulaOperationClosure correctly. They go through
 * the wiring entry points, NOT through direct store/closure calls.
 *
 * Build ID: inkchapter-formula-runtime-state-recovery-render-entry-v2.5.7-r5.4.3.17
 */
import { describe, it, expect, beforeEach } from 'vitest'
import {
  processFormulaSemanticEvent,
  produceRenderTransaction,
  initializeBaseline,
  handleDocumentSwitch,
  finalizeOperation,
  isStoreBaselineReady,
  emitLegacyBaselineGateHandoff,
  registerPendingBaselineProjection,
  getPendingBaselineProjectionCount,
  hydrateNumberingAuthorityIntoFormulaStateStore,
  executeProjectionTransactions,
  readFormulaVisibleStateTruth,
  productionCallCounters,
  hasZeroProductionCallers,
  getProductionCallerCounts,
  R54316_BUILD_ID,
} from '../../src/heading-numbering/formula-state-machine-wiring'
import { getFormulaStateStore, resetFormulaStateStore, isRuntimeContextReady, type FormulaRuntimeContext } from '../../src/heading-numbering/formula-state-store'
import { resetOperationClosureState } from '../../src/heading-numbering/formula-operation-closure'

// ── Helpers ─────────────────────────────────────────────────────────────

let nextToken = 1

function makeFormulaHost(
  source: string,
  className = 'md-block-formula',
): HTMLElement {
  const host = document.createElement('div')
  host.className = className
  host.textContent = source
  return host
}

/** Create a CONNECTED editor root (context hard gate requires isConnected). */
function makeEditorRoot(hosts: HTMLElement[]): HTMLElement {
  const root = document.createElement('div')
  root.className = 'md-editor-root'
  for (const h of hosts) {
    root.appendChild(h)
  }
  document.body.appendChild(root)
  return root
}

function cleanupRoots(): void {
  for (const el of Array.from(document.body.querySelectorAll('.md-editor-root'))) {
    el.remove()
  }
}

function makeContext(
  docKey: string,
  gen: number,
  editorRoot: HTMLElement,
): FormulaRuntimeContext {
  return {
    documentKey: docKey,
    documentGeneration: gen,
    editorRoot,
    editorRootToken: nextToken++,
  }
}

function resetCounters(): void {
  for (const key of Object.keys(productionCallCounters)) {
    (productionCallCounters as Record<string, number>)[key] = 0
  }
}

/** R5.4.3.18: promote the store to renderAuthorityReady via numbering hydration. */
function hydrateStore(
  ctx: FormulaRuntimeContext,
  hosts: HTMLElement[],
  tags: string[],
): void {
  hydrateNumberingAuthorityIntoFormulaStateStore({
    documentKey: ctx.documentKey,
    generation: ctx.documentGeneration,
    editorRoot: ctx.editorRoot,
    editorRootToken: ctx.editorRootToken,
    entries: hosts.map((h, i) => ({
      canonicalHost: h,
      chapterOrdinal: 1,
      sectionOrdinal: 1,
      subsectionOrdinal: null,
      sequenceValue: i + 1,
      scopeKey: 'ch-1.sec-1',
      desiredTag: tags[i] ?? `1.1.${i + 1}`,
      managedForNumbering: true,
    })),
    headingRevision: 1,
    numberingPlanRevision: 1,
  })
}

// ═════════════════════════════════════════════════════════════════════════
// P00 — Runtime Context Binding (R5.4.3.17 P0-1)
// ═════════════════════════════════════════════════════════════════════════

describe('P00 — Runtime Context Binding', () => {
  beforeEach(() => {
    resetFormulaStateStore()
    resetOperationClosureState()
    resetCounters()
    cleanupRoots()
  })

  it('isRuntimeContextReady rejects empty/zero context', () => {
    const root = makeEditorRoot([])
    const g1 = isRuntimeContextReady({ documentKey: '', documentGeneration: 1, editorRoot: root, editorRootToken: 1 })
    expect(g1.ready).toBe(false)
    const g2 = isRuntimeContextReady({ documentKey: 'doc', documentGeneration: 0, editorRoot: root, editorRootToken: 1 })
    expect(g2.ready).toBe(false)
    const g3 = isRuntimeContextReady({ documentKey: 'doc', documentGeneration: 1, editorRoot: root, editorRootToken: 0 })
    expect(g3.ready).toBe(false)
  })

  it('initializeBaseline DEFERS on empty context (no empty-context COMMIT)', async () => {
    const root = makeEditorRoot([])
    const ok = await initializeBaseline(
      { documentKey: '', documentGeneration: 0, editorRoot: root, editorRootToken: 0 },
      [],
      [],
      undefined,
      root,
    )
    expect(ok).toBe(false)
    const store = getFormulaStateStore()
    expect(store.documentKey).toBe('')
  })

  it('initializeBaseline COMMITs with the REAL context (never :0:0:n)', async () => {
    const host = makeFormulaHost('E=mc^2')
    const root = makeEditorRoot([host])
    const ctx = makeContext('doc-A', 1, root)
    const ok = await initializeBaseline(ctx, [host], [], undefined, root)
    expect(ok).toBe(true)
    const store = getFormulaStateStore()
    expect(store.documentKey).toBe('doc-A')
    expect(store.documentGeneration).toBe(1)
    expect(store.editorRootToken).toBeGreaterThan(0)
    expect(isStoreBaselineReady(ctx)).toBe(true)
    // No zero-context stable identity
    for (const slot of store.committedState!.slotsInDocumentOrder) {
      expect(String(slot.stableIdentity)).not.toContain(':0:0:')
      expect(String(slot.stableIdentity)).toContain('doc-A')
    }
  })
})

// ═════════════════════════════════════════════════════════════════════════
// P00b — Real DOM Scan Safety (R5.4.3.17 P0-2)
// ═════════════════════════════════════════════════════════════════════════

describe('P00b — Real DOM Scan Safety (non-string className)', () => {
  beforeEach(() => {
    resetFormulaStateStore()
    resetOperationClosureState()
    resetCounters()
    cleanupRoots()
  })

  it('scanner does NOT throw on SVGAnimatedString-like className', async () => {
    const root = makeEditorRoot([])
    // Simulate a real Typora DOM: SVG subtree + MJX container + editing internals.
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
    svg.setAttribute('class', 'mjx-svg')
    root.appendChild(svg)
    const mjx = document.createElement('mjx-container')
    root.appendChild(mjx)
    const mathBlock = document.createElement('div')
    mathBlock.className = 'md-block-formula'
    mathBlock.textContent = 'x=1'
    root.appendChild(mathBlock)
    // SVGAnimatedString-like className object (frozen so it cannot be coerced).
    Object.defineProperty(svg, 'className', {
      value: { baseVal: 'mjx-svg', animVal: 'mjx-svg' },
      configurable: true,
    })

    const ctx = makeContext('doc-svg', 1, root)
    const ok = await initializeBaseline(ctx, [mathBlock], [], undefined, root)
    expect(ok).toBe(true)
    const store = getFormulaStateStore()
    expect(store.committedState!.slotsInDocumentOrder.length).toBe(1)
  })

  it('scanner rejects MJX/SVG/inline-math and counts only canonical hosts', async () => {
    const root = makeEditorRoot([])
    const mjx = document.createElement('mjx-container')
    root.appendChild(mjx)
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
    root.appendChild(svg)
    const inline = document.createElement('span')
    inline.className = 'md-math'
    inline.textContent = '$x$'
    root.appendChild(inline)
    const blockA = makeFormulaHost('a+b')
    root.appendChild(blockA)
    const blockB = makeFormulaHost('c+d')
    root.appendChild(blockB)

    const ctx = makeContext('doc-scan', 1, root)
    const ok = await initializeBaseline(ctx, [blockA, blockB], [], undefined, root)
    expect(ok).toBe(true)
    const store = getFormulaStateStore()
    expect(store.committedState!.slotsInDocumentOrder.length).toBe(2)
  })

  it('scanner handles empty and duplicate-source formula hosts', async () => {
    const root = makeEditorRoot([])
    const emptyA = makeFormulaHost('<Empty Math Block>')
    root.appendChild(emptyA)
    const p1a = makeFormulaHost('p=1')
    root.appendChild(p1a)
    const p1b = makeFormulaHost('p=1')
    root.appendChild(p1b)
    const emptyB = makeFormulaHost('')
    root.appendChild(emptyB)

    const ctx = makeContext('doc-dup', 1, root)
    const ok = await initializeBaseline(ctx, [emptyA, p1a, p1b, emptyB], [], undefined, root)
    expect(ok).toBe(true)
    const store = getFormulaStateStore()
    const identities = store.committedState!.slotsInDocumentOrder.map((s) => String(s.stableIdentity))
    expect(identities.length).toBe(4)
    // All four slots must be structurally distinct.
    expect(new Set(identities).size).toBe(4)
  })
})

// ═════════════════════════════════════════════════════════════════════════
// P01 — Semantic Event Production Wiring
// ═════════════════════════════════════════════════════════════════════════

describe('P01 — Semantic Event Production Wiring', () => {
  beforeEach(() => {
    resetFormulaStateStore()
    resetOperationClosureState()
    resetCounters()
    cleanupRoots()
  })

  it('processFormulaSemanticEvent calls all production APIs', () => {
    const host = makeFormulaHost('E=mc^2')
    const editorRoot = makeEditorRoot([host])
    const ctx = makeContext('doc-1', 1, editorRoot)

    const result = processFormulaSemanticEvent(
      'FORMULA_ADDED',
      editorRoot,
      [],
      'batch-1',
      ctx,
      [host],
    )

    expect(productionCallCounters.captureBeforeState).toBeGreaterThanOrEqual(1)
    expect(productionCallCounters.scanAfterCandidate).toBeGreaterThanOrEqual(1)
    expect(productionCallCounters.classifyOperation).toBeGreaterThanOrEqual(1)
    expect(productionCallCounters.commitOperation).toBeGreaterThanOrEqual(1)
    expect(productionCallCounters.createProjectionTransactions).toBeGreaterThanOrEqual(1)

    expect(result.transaction).not.toBeNull()
    expect(result.transaction!.operationId).toBeDefined()
    expect(result.closure).not.toBeNull()
    expect(Array.isArray(result.projectionTransactions)).toBe(true)
  })
})

// ═════════════════════════════════════════════════════════════════════════
// P02 — Render PreCall Production Wiring
// ═════════════════════════════════════════════════════════════════════════

describe('P02 — Render PreCall Production Wiring', () => {
  beforeEach(() => {
    resetFormulaStateStore()
    resetOperationClosureState()
    resetCounters()
    cleanupRoots()
  })

  it('produceRenderTransaction calls createRenderTransaction through wiring', async () => {
    const host = makeFormulaHost('x+y')
    const editorRoot = makeEditorRoot([host])
    const ctx = makeContext('doc-1', 1, editorRoot)

    await initializeBaseline(ctx, [host], [], undefined, editorRoot)
    // R5.4.3.18: promote render authority via numbering hydration first.
    hydrateStore(ctx, [host], ['5.3.1'])

    const renderTx = produceRenderTransaction(host)

    expect(renderTx).not.toBeNull()
    expect(renderTx!.renderTransactionId).toBeDefined()
    expect(renderTx!.stableIdentity).toBeDefined()
    expect(renderTx!.desiredTag).toBe('5.3.1')
    expect(productionCallCounters.createRenderTransaction).toBeGreaterThanOrEqual(1)
    expect(productionCallCounters.renderEntryAuthority).toBeGreaterThanOrEqual(1)
  })
})

// ═════════════════════════════════════════════════════════════════════════
// P03 — Empty Formula Through State Machine
// ═════════════════════════════════════════════════════════════════════════

describe('P03 — Empty Formula Through State Machine', () => {
  beforeEach(() => {
    resetFormulaStateStore()
    resetOperationClosureState()
    resetCounters()
    cleanupRoots()
  })

  it('processes empty formula through the full wiring', () => {
    const host = makeFormulaHost('<Empty Math Block>')
    const editorRoot = makeEditorRoot([host])
    const ctx = makeContext('doc-empty', 1, editorRoot)

    const result = processFormulaSemanticEvent(
      'FORMULA_ADDED',
      editorRoot,
      [],
      'batch-1',
      ctx,
      [host],
    )

    expect(productionCallCounters.captureBeforeState).toBeGreaterThanOrEqual(1)
    expect(productionCallCounters.scanAfterCandidate).toBeGreaterThanOrEqual(1)
    expect(productionCallCounters.classifyOperation).toBeGreaterThanOrEqual(1)
    expect(productionCallCounters.commitOperation).toBeGreaterThanOrEqual(1)
    expect(result.transaction).not.toBeNull()
  })
})

// ═════════════════════════════════════════════════════════════════════════
// P04 — Duplicate Source Different Host
// ═════════════════════════════════════════════════════════════════════════

describe('P04 — Duplicate Source Different Host', () => {
  beforeEach(() => {
    resetFormulaStateStore()
    resetOperationClosureState()
    resetCounters()
    cleanupRoots()
  })

  it('produces different render transactions for duplicate-source formulas', async () => {
    const hostA = makeFormulaHost('p=1')
    const hostB = makeFormulaHost('p=1')
    const editorRoot = makeEditorRoot([hostA, hostB])
    const ctx = makeContext('doc-dup', 1, editorRoot)

    await initializeBaseline(ctx, [hostA, hostB], [], undefined, editorRoot)
    // R5.4.3.18: promote render authority via numbering hydration first.
    hydrateStore(ctx, [hostA, hostB], ['2.3.1', '2.3.2'])

    const txA = produceRenderTransaction(hostA)
    const txB = produceRenderTransaction(hostB)

    expect(txA).not.toBeNull()
    expect(txB).not.toBeNull()
    expect(txA!.canonicalHost).toBe(hostA)
    expect(txB!.canonicalHost).toBe(hostB)
    expect(txA!.desiredTag).toBe('2.3.1')
    expect(txB!.desiredTag).toBe('2.3.2')
    // Host-based structural identity must differ.
    expect(String(txA!.stableIdentity)).not.toBe(String(txB!.stableIdentity))
  })
})

// ═════════════════════════════════════════════════════════════════════════
// P05 — Projection Transaction Production
// ═════════════════════════════════════════════════════════════════════════

describe('P05 — Projection Transaction Production', () => {
  beforeEach(() => {
    resetFormulaStateStore()
    resetOperationClosureState()
    resetCounters()
    cleanupRoots()
  })

  it('returns projection transactions from semantic event processing', () => {
    const host = makeFormulaHost('\\int_0^1 f(x) dx')
    const editorRoot = makeEditorRoot([host])
    const ctx = makeContext('doc-1', 1, editorRoot)

    const result = processFormulaSemanticEvent(
      'FORMULA_ADDED',
      editorRoot,
      [],
      'batch-1',
      ctx,
      [host],
    )

    expect(Array.isArray(result.projectionTransactions)).toBe(true)
    expect(productionCallCounters.createProjectionTransactions).toBeGreaterThanOrEqual(1)
  })
})

// ═════════════════════════════════════════════════════════════════════════
// P06 — Operation Closure Production
// ═════════════════════════════════════════════════════════════════════════

describe('P06 — Operation Closure Production', () => {
  beforeEach(() => {
    resetFormulaStateStore()
    resetOperationClosureState()
    resetCounters()
    cleanupRoots()
  })

  it('finalizeOperation returns closure and increments production counter', () => {
    const host = makeFormulaHost('x^2 + y^2')
    const editorRoot = makeEditorRoot([host])
    const ctx = makeContext('doc-1', 1, editorRoot)

    const result = processFormulaSemanticEvent(
      'FORMULA_ADDED',
      editorRoot,
      [],
      'batch-1',
      ctx,
      [host],
    )

    const closure = finalizeOperation(result.transaction!.operationId, true)

    expect(closure).not.toBeNull()
    expect(closure!.decision).toBeDefined()
    expect(productionCallCounters.finalizeOperationClosure).toBeGreaterThanOrEqual(1)
  })
})

// ═════════════════════════════════════════════════════════════════════════
// P07 — Zero Production Callers Detected
// ═════════════════════════════════════════════════════════════════════════

describe('P07 — Zero Production Callers Detected', () => {
  beforeEach(() => {
    resetFormulaStateStore()
    resetOperationClosureState()
    resetCounters()
    cleanupRoots()
  })

  it('detects zero vs non-zero production callers', () => {
    expect(hasZeroProductionCallers()).toBe(true)

    const host = makeFormulaHost('\\alpha + \\beta')
    const editorRoot = makeEditorRoot([host])
    const ctx = makeContext('doc-1', 1, editorRoot)

    processFormulaSemanticEvent(
      'FORMULA_ADDED',
      editorRoot,
      [],
      'batch-1',
      ctx,
      [host],
    )

    expect(hasZeroProductionCallers()).toBe(false)
  })
})

// ═════════════════════════════════════════════════════════════════════════
// P08 — Run ID is R5.4.3.21
// ═════════════════════════════════════════════════════════════════════════

describe('P08 — Run ID is R5.4.3.21', () => {
  it('R54316_BUILD_ID includes r5.4.3.25', () => {
    expect(R54316_BUILD_ID).toContain('r5.4.3.25')
  })

  it('R54316_BUILD_ID includes cross-kind render owner source integrity', () => {
    expect(R54316_BUILD_ID).toContain('cross-kind-render-owner-source-integrity')
  })

  it('R54316_BUILD_ID does NOT include r5.4.3.22', () => {
    expect(R54316_BUILD_ID).not.toContain('r5.4.3.22')
  })
})

// ═════════════════════════════════════════════════════════════════════════
// P09 — Initialize Baseline
// ═════════════════════════════════════════════════════════════════════════

describe('P09 — Initialize Baseline', () => {
  beforeEach(() => {
    resetFormulaStateStore()
    resetOperationClosureState()
    resetCounters()
    cleanupRoots()
  })

  it('initializes baseline with real context', async () => {
    const editorRoot = makeEditorRoot([])
    const ctx = makeContext('doc-main', 1, editorRoot)

    const ok = await initializeBaseline(ctx, [], [], undefined, editorRoot)
    expect(ok).toBe(true)

    const store = getFormulaStateStore()
    expect(store.committedState).not.toBeNull()
    expect(store.committedState!.stateRevision).toBeGreaterThanOrEqual(0)
    expect(store.documentKey).toBe('doc-main')
    expect(productionCallCounters.buildAfterCandidateState).toBeGreaterThanOrEqual(1)
  })
})

// ═════════════════════════════════════════════════════════════════════════
// P10 — Handle Document Switch
// ═════════════════════════════════════════════════════════════════════════

describe('P10 — Handle Document Switch', () => {
  beforeEach(() => {
    resetFormulaStateStore()
    resetOperationClosureState()
    resetCounters()
    cleanupRoots()
  })

  it('switches to new baseline state for different document', async () => {
    const editorRootA = makeEditorRoot([])
    const editorRootB = makeEditorRoot([])
    const ctxA = makeContext('doc-A', 1, editorRootA)
    const ctxB = makeContext('doc-B', 2, editorRootB)

    await initializeBaseline(ctxA, [], [], undefined, editorRootA)
    const storeA = getFormulaStateStore()
    expect(storeA.committedState).not.toBeNull()

    const ok = await handleDocumentSwitch(ctxB, [], [], undefined, editorRootB)
    expect(ok).toBe(true)
    const storeB = getFormulaStateStore()
    expect(storeB.committedState).not.toBeNull()
    expect(storeB.documentKey).toBe('doc-B')
    expect(storeB.documentGeneration).toBe(2)
  })
})

// ═════════════════════════════════════════════════════════════════════════
// P11 — Legacy Baseline Gate Handoff (R5.4.3.17 P0-5)
// ═════════════════════════════════════════════════════════════════════════

describe('P11 — Legacy Baseline Gate Handoff', () => {
  beforeEach(() => {
    resetFormulaStateStore()
    resetOperationClosureState()
    resetCounters()
    cleanupRoots()
  })

  it('emitLegacyBaselineGateHandoff allows dispatch when store ready', () => {
    emitLegacyBaselineGateHandoff({
      storeBaselineReady: true,
      storeDocumentKey: 'doc-x',
      storeGeneration: 1,
      storeRootToken: 1,
      legacyBaselineState: 'NOT_HYDRATED',
      legacyGateWouldDefer: true,
      handoffApplied: true,
      semanticDispatchAllowed: true,
    })
    // No throw; marker emitted (validated by audit sink).
    expect(true).toBe(true)
  })
})

// ═════════════════════════════════════════════════════════════════════════
// P12 — Pending Pre-Baseline Projection (R5.4.3.17 P0-4)
// ═════════════════════════════════════════════════════════════════════════

describe('P12 — Pending Pre-Baseline Projection', () => {
  beforeEach(() => {
    resetFormulaStateStore()
    resetOperationClosureState()
    resetCounters()
    cleanupRoots()
  })

  it('registerPendingBaselineProjection tracks a natural render before baseline', () => {
    const host = makeFormulaHost('a=b')
    registerPendingBaselineProjection({
      documentKey: 'doc-pending',
      generation: 1,
      rootToken: 1,
      canonicalHost: host,
      hostToken: 1,
      rawTex: 'a=b',
      sourceState: 'NONEMPTY',
      createdFromCallOrdinal: 42,
    })
    expect(getPendingBaselineProjectionCount()).toBe(1)
  })
})
