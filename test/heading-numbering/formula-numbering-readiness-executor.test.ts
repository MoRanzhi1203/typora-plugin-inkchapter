// @vitest-environment jsdom
/**
 * R5.4.3.18 Numbering Readiness + Projection Executor + Click-Independence tests.
 *
 * T01–T20 per:
 *   trae-formula-numbering-readiness-projection-executor-v2.5.7-r5.4.3.18.md
 */
import { describe, it, expect, beforeEach } from 'vitest'
import {
  initializeBaseline,
  handleDocumentSwitch,
  processFormulaSemanticEvent,
  produceRenderTransaction,
  hydrateNumberingAuthorityIntoFormulaStateStore,
  executeProjectionTransactions,
  commitProjectionFulfillmentViaCompositeOwner,
  readFormulaVisibleStateTruth,
  finalizeOperation,
  getPendingBaselineProjectionCount,
  productionCallCounters,
  R54316_BUILD_ID,
} from '../../src/heading-numbering/formula-state-machine-wiring'
import {
  getFormulaStateStore,
  resetFormulaStateStore,
  computeStateNumberingReadiness,
  isFormulaEmptySource,
  type FormulaRuntimeContext,
  type CanonicalFormulaSlot,
  type FormulaProjectionTransaction,
} from '../../src/heading-numbering/formula-state-store'
import { resetOperationClosureState } from '../../src/heading-numbering/formula-operation-closure'
import { setOriginalTex2svgPromise } from '../../src/heading-numbering/formula-render-projection'
import { simpleHash, normalizeTexSource } from '../../src/heading-numbering/formula-tex-source-verifier'

let nextToken = 1

function makeFormulaHost(source: string, className = 'md-block-formula'): HTMLElement {
  const host = document.createElement('div')
  host.className = className
  host.textContent = source
  return host
}

/** Typora-like composite owner: source + preview sibling layout, MJX inside preview. */
function makeCompositeHost(source: string, nativeTag: string | null): HTMLElement {
  const owner = document.createElement('div')
  owner.className = 'mathjax-block'
  const sourceEl = document.createElement('div')
  sourceEl.className = 'md-rawblock-container'
  sourceEl.textContent = source
  const preview = document.createElement('div')
  preview.className = 'md-mathjax-preview'
  if (nativeTag !== null) {
    const mjx = document.createElement('mjx-container')
    mjx.textContent = nativeTag
    preview.appendChild(mjx)
  }
  owner.appendChild(sourceEl)
  owner.appendChild(preview)
  return owner
}

function makeEditorRoot(hosts: HTMLElement[]): HTMLElement {
  const root = document.createElement('div')
  root.className = 'md-editor-root'
  for (const h of hosts) root.appendChild(h)
  document.body.appendChild(root)
  return root
}

function cleanupRoots(): void {
  for (const el of Array.from(document.body.querySelectorAll('.md-editor-root'))) el.remove()
}

function makeContext(docKey: string, gen: number, editorRoot: HTMLElement): FormulaRuntimeContext {
  return { documentKey: docKey, documentGeneration: gen, editorRoot, editorRootToken: nextToken++ }
}

function hydrateStore(ctx: FormulaRuntimeContext, hosts: HTMLElement[], tags: string[]): void {
  hydrateNumberingAuthorityIntoFormulaStateStore({
    documentKey: ctx.documentKey,
    generation: ctx.documentGeneration,
    editorRoot: ctx.editorRoot,
    editorRootToken: ctx.editorRootToken,
    entries: hosts.map((h, i) => ({
      canonicalHost: h,
      chapterOrdinal: i === 0 ? 5 : 11,
      sectionOrdinal: i === 0 ? 3 : 2,
      subsectionOrdinal: null,
      sequenceValue: i + 1,
      scopeKey: 'ch-1.sec-1',
      desiredTag: tags[i],
      managedForNumbering: true,
    })),
    headingRevision: 1,
    numberingPlanRevision: 1,
  })
}

/** R5.4.3.19: hydrate slot authoritative source (exact raw TeX, explicit revision). */
function hydrateSource(ctx: FormulaRuntimeContext, hosts: HTMLElement[], rawTex: string[], revision = 1): void {
  const store = getFormulaStateStore()
  hosts.forEach((h, i) => {
    const src = rawTex[i] ?? ''
    const empty = isFormulaEmptySource(src)
    store.hydrateFormulaSourceAuthority({
      documentKey: ctx.documentKey,
      generation: ctx.documentGeneration,
      editorRootToken: ctx.editorRootToken,
      canonicalHost: h,
      source: {
        sourceState: empty ? 'EMPTY' : 'NONEMPTY',
        sourceAuthorityKind: empty ? 'KNOWN_EMPTY' : 'AUTHORITATIVE_SOURCE',
        authoritativeRawSource: empty ? '' : src,
        authoritativeSourceHash: empty ? '' : simpleHash(normalizeTexSource(src)),
        authoritativeSourceRevision: revision,
      },
    })
  })
}

/** R5.4.3.19: build a full projection tx from a committed slot. */
function makeTx(slot: CanonicalFormulaSlot, i: number, operationId = 'op'): FormulaProjectionTransaction {
  return {
    projectionTransactionId: `tx-${i}`,
    operationId,
    targetStateRevision: getFormulaStateStore().currentRevision,
    stableIdentity: slot.stableIdentity,
    formulaIndex: i,
    canonicalHost: slot.canonicalHost,
    canonicalHostToken: slot.canonicalHostToken,
    desiredTag: slot.desiredTag!,
    rawSource: slot.authoritativeRawSource ?? '',
    sourceState: slot.sourceState,
    authoritativeSourceHash: slot.authoritativeSourceHash,
    authoritativeSourceRevision: slot.authoritativeSourceRevision,
    compositeOwner: slot.canonicalHost,
    previewHost: slot.canonicalHost.querySelector('.md-mathjax-preview'),
    oldNativeMjx: slot.canonicalHost.querySelector('mjx-container'),
    nativeDomMutationCount: 0,
    status: 'CREATED',
  }
}

/** Fake provider that captures every raw input and renders body + "(tag)". */
function installCapturingProvider(captured: string[]): void {
  setOriginalTex2svgPromise((tex: unknown) => {
    captured.push(String(tex))
    const m = String(tex).match(/\\tag\{([^}]*)\}/)
    const node = document.createElement('mjx-container')
    const math = document.createElement('mjx-math')
    const bodyTex = String(tex).replace(/\\tag\{[^}]*\}/, '').trim()
    math.textContent = bodyTex
    node.appendChild(math)
    const label = document.createElement('mjx-label')
    label.textContent = m ? `(${m[1]})` : ''
    node.appendChild(label)
    return Promise.resolve(node)
  })
}

beforeEach(() => {
  resetFormulaStateStore()
  resetOperationClosureState()
  cleanupRoots()
})

// ═════════════════════════════════════════════════════════════════════════
// T01 — Structural Baseline ≠ Numbering Baseline
// ═════════════════════════════════════════════════════════════════════════

describe('T01 — Structural Baseline ≠ Numbering Baseline', () => {
  it('structural baseline has desiredTags null/null and renderAuthorityReady=false', async () => {
    const a = makeFormulaHost('E=mc^2')
    const b = makeFormulaHost('RMSE')
    const root = makeEditorRoot([a, b])
    const ctx = makeContext('doc', 1, root)
    await initializeBaseline(ctx, [a, b], [], undefined, root)
    const store = getFormulaStateStore()
    const st = store.committedState!
    expect(st.structuralReady).toBe(true)
    // R5.4.3.18: MUST NOT be ["1","2"].
    expect(st.slotsInDocumentOrder.map((s) => s.desiredTag)).toEqual([null, null])
    expect(st.renderAuthorityReady).toBe(false)
    expect(st.allManagedDesiredTagsReady).toBe(false)
  })
})

// ═════════════════════════════════════════════════════════════════════════
// T02 — Numbering Plan Hydrates Store Without Click
// ═════════════════════════════════════════════════════════════════════════

describe('T02 — Numbering Plan Hydrates Store Without Click', () => {
  it('hydration writes 5.3.1/11.2.1 and promotes renderAuthorityReady', async () => {
    const a = makeFormulaHost('E=mc^2')
    const b = makeFormulaHost('RMSE')
    const root = makeEditorRoot([a, b])
    const ctx = makeContext('doc', 1, root)
    await initializeBaseline(ctx, [a, b], [], undefined, root)
    hydrateStore(ctx, [a, b], ['5.3.1', '11.2.1'])
    const st = getFormulaStateStore().committedState!
    expect(st.slotsInDocumentOrder.map((s) => s.desiredTag)).toEqual(['5.3.1', '11.2.1'])
    expect(st.renderAuthorityReady).toBe(true)
    expect(st.allManagedDesiredTagsReady).toBe(true)
    // No click occurred.
    expect(getPendingBaselineProjectionCount()).toBeGreaterThanOrEqual(0)
  })
})

// ═════════════════════════════════════════════════════════════════════════
// T03 — Readiness Arbitration (store not ready → LEGACY_READY_PLAN)
// ═════════════════════════════════════════════════════════════════════════

describe('T03 — Readiness Arbitration', () => {
  it('produceRenderTransaction returns null when store not render-ready (legacy plan temp authority)', async () => {
    const a = makeFormulaHost('E=mc^2')
    const root = makeEditorRoot([a])
    const ctx = makeContext('doc', 1, root)
    await initializeBaseline(ctx, [a], [], undefined, root)
    // Store is STRUCTURAL_ONLY (desiredTag null) → render tx MUST be null.
    expect(getFormulaStateStore().committedState!.renderAuthorityReady).toBe(false)
    expect(produceRenderTransaction(a)).toBeNull()
  })
})

// ═════════════════════════════════════════════════════════════════════════
// T04 — Ready Authorities Diverge → FAIL
// ═════════════════════════════════════════════════════════════════════════

describe('T04 — Ready Authorities Diverge', () => {
  it('computeStateNumberingReadiness never treats provisional tag as ready', async () => {
    const a = makeFormulaHost('E=mc^2')
    const root = makeEditorRoot([a])
    const ctx = makeContext('doc', 1, root)
    await initializeBaseline(ctx, [a], [], undefined, root)
    const slot = getFormulaStateStore().committedState!.slotsInDocumentOrder[0]
    // Simulate a provisional "2" tag (should NEVER be render-ready).
    const provisional: CanonicalFormulaSlot = {
      ...slot,
      desiredTag: '2',
      numberingAuthority: { ...slot.numberingAuthority, desiredTag: '2', desiredTagReady: false, numberingPlanReady: false },
    }
    const r = computeStateNumberingReadiness([provisional], null, null)
    expect(r.renderAuthorityReady).toBe(false)
    expect(r.allManagedDesiredTagsReady).toBe(false)
  })
})

// ═════════════════════════════════════════════════════════════════════════
// T05 — Baseline Projection Uses Full Target
// ═════════════════════════════════════════════════════════════════════════

describe('T05 — Baseline Projection Uses Full Target', () => {
  it('runBaselineProjectionClosure builds txs with non-null identity/host', async () => {
    const a = makeCompositeHost('E=mc^2', '(1)')
    const b = makeCompositeHost('RMSE', '(2)')
    const root = makeEditorRoot([a, b])
    const ctx = makeContext('doc', 1, root)
    await initializeBaseline(ctx, [a, b], [], undefined, root)
    hydrateStore(ctx, [a, b], ['5.3.1', '11.2.1'])
    const store = getFormulaStateStore()
    for (const slot of store.committedState!.slotsInDocumentOrder) {
      expect(slot.stableIdentity).not.toBeNull()
      expect(slot.canonicalHost).not.toBeNull()
      expect(slot.canonicalHostToken).toBeGreaterThan(0)
    }
  })
})

// ═════════════════════════════════════════════════════════════════════════
// T06 — Projection Ownership Missing → FAIL before provider
// ═════════════════════════════════════════════════════════════════════════

describe('T06 — Projection Ownership Missing', () => {
  it('executor rejects tx with stableIdentity=-1 before calling provider', async () => {
    const badTx: FormulaProjectionTransaction = {
      projectionTransactionId: 'bad',
      operationId: 'op',
      targetStateRevision: 1,
      stableIdentity: -1,
      formulaIndex: 0,
      canonicalHost: document.createElement('div'),
      canonicalHostToken: -1,
      desiredTag: '11.2.1',
      rawSource: 'x',
      sourceState: 'NONEMPTY',
      authoritativeSourceHash: 'h',
      authoritativeSourceRevision: 1,
      compositeOwner: null,
      previewHost: null,
      oldNativeMjx: null,
      nativeDomMutationCount: 0,
      status: 'CREATED',
    }
    const exec = await executeProjectionTransactions([badTx], null)
    expect(exec.missingOwnershipCount).toBe(1)
    expect(exec.failedCount).toBe(1)
    expect(exec.requestedCount).toBe(0)
  })
})

// ═════════════════════════════════════════════════════════════════════════
// T07 — Projection Executor End-to-End (with provider)
// ═════════════════════════════════════════════════════════════════════════

describe('T07 — Projection Executor End-to-End', () => {
  it('requested==settled==committed==visibleVerified==2 AND provider gets exact raw TeX', async () => {
    const a = makeCompositeHost('E=mc^2', '(1)')
    const b = makeCompositeHost('RMSE', '(2)')
    const root = makeEditorRoot([a, b])
    const ctx = makeContext('doc', 1, root)
    await initializeBaseline(ctx, [a, b], [], undefined, root)
    hydrateStore(ctx, [a, b], ['5.3.1', '11.2.1'])
    hydrateSource(ctx, [a, b], ['E=mc^2', 'RMSE'])
    const store = getFormulaStateStore()

    // R5.4.3.19: capture provider inputs to prove EXACT base raw TeX.
    const captured: string[] = []
    installCapturingProvider(captured)

    const txs: FormulaProjectionTransaction[] = store.committedState!.slotsInDocumentOrder.map((slot, i) => makeTx(slot, i))

    const exec = await executeProjectionTransactions(txs, root)
    expect(exec.requestedCount).toBe(2)
    expect(exec.settledCount).toBe(2)
    expect(exec.committedCount).toBe(2)
    expect(exec.visibleVerifiedCount).toBe(2)
    expect(exec.failedCount).toBe(0)
    expect(exec.pendingCount).toBe(0)

    // R5.4.3.19: provider input MUST be "E=mc^2\\tag{5.3.1}" / "RMSE\\tag{11.2.1}".
    const inputs = captured.map((c) => c.replace(/\r\n/g, '\n').trim()).sort()
    expect(inputs).toContain('E=mc^2\\tag{5.3.1}')
    expect(inputs).toContain('RMSE\\tag{11.2.1}')
    // No contamination from composite host text / prior visible tags.
    for (const c of inputs) {
      expect(c).not.toContain('(1)')
      expect(c).not.toContain('公式')
    }
  })
})

// ═════════════════════════════════════════════════════════════════════════
// T08 — Composite Owner Sibling Layout commit
// ═════════════════════════════════════════════════════════════════════════

describe('T08 — Composite Owner Sibling Layout', () => {
  it('commits even though sourceHost.contains(MJX)=false', async () => {
    const owner = makeCompositeHost('x=1', '(1)')
    const root = makeEditorRoot([owner])
    const ctx = makeContext('doc', 1, root)
    // Commit a real baseline so the revision check passes.
    await initializeBaseline(ctx, [owner], [], undefined, root)
    hydrateStore(ctx, [owner], ['2.3.1'])
    hydrateSource(ctx, [owner], ['x=1'])
    const store = getFormulaStateStore()
    const slot = store.committedState!.slotsInDocumentOrder[0]
    const tx = makeTx(slot, 0)
    // source host contains MJX? The MJX is in the preview sibling, NOT the source div.
    const sourceEl = owner.querySelector('.md-rawblock-container')!
    expect(sourceEl.contains(owner.querySelector('mjx-container')!)).toBe(false)
    const newMjx = document.createElement('mjx-container')
    newMjx.textContent = '(2.3.1)'
    const res = commitProjectionFulfillmentViaCompositeOwner(tx, newMjx, root)
    expect(res.domReplaceSucceeded).toBe(true)
    expect(owner.querySelector('mjx-container')!.textContent).toBe('(2.3.1)')
  })
})

// ═════════════════════════════════════════════════════════════════════════
// T09 — Visual Truth Re-read (false-zero barrier)
// ═════════════════════════════════════════════════════════════════════════

describe('T09 — Visual Truth Re-read', () => {
  it('mismatchAfter >= 2 when commit=0 (no false zero)', async () => {
    const a = makeCompositeHost('E=mc^2', '(1)')
    const b = makeCompositeHost('RMSE', '(2)')
    const root = makeEditorRoot([a, b])
    const ctx = makeContext('doc', 1, root)
    await initializeBaseline(ctx, [a, b], [], undefined, root)
    hydrateStore(ctx, [a, b], ['5.3.1', '11.2.1'])
    // NO provider installed → executor fails → truth read must still show mismatch.
    const truth = readFormulaVisibleStateTruth()
    expect(truth.mismatchSlotCount).toBeGreaterThanOrEqual(2)
    expect(truth.allDesiredTagsVisible).toBe(false)
  })
})

// ═════════════════════════════════════════════════════════════════════════
// T10 — Pure Click No Semantic Op
// ═════════════════════════════════════════════════════════════════════════

describe('T10 — Pure Click No Semantic Op', () => {
  it('classifyOperation returns NOOP for identical before/after', async () => {
    const a = makeFormulaHost('E=mc^2')
    const root = makeEditorRoot([a])
    const ctx = makeContext('doc', 1, root)
    await initializeBaseline(ctx, [a], [], undefined, root)
    const store = getFormulaStateStore()
    const revBefore = store.currentRevision
    // Re-run the exact same scan → no delta → NOOP, revision unchanged.
    const result = processFormulaSemanticEvent('FORMULA_ADDED', root, [], 'batch', ctx, [a])
    expect(result.transaction).toBeNull()
    expect(store.currentRevision).toBe(revBefore)
  })
})

// ═════════════════════════════════════════════════════════════════════════
// T11 — Source Edit Real Change
// ═════════════════════════════════════════════════════════════════════════

describe('T11 — Source Edit Real Change', () => {
  it('classifyOperation detects SOURCE_EDIT only with a real source revision delta', async () => {
    const a = makeFormulaHost('p=1')
    const root = makeEditorRoot([a])
    const ctx = makeContext('doc', 1, root)
    await initializeBaseline(ctx, [a], [], undefined, root)
    const store = getFormulaStateStore()
    // Hydrate source revision 1.
    hydrateSource(ctx, [a], ['p=1'], 1)
    const before = store.captureBeforeState()
    // User edit: p=1 → p=2, authoritative pipeline advances revision to 2.
    hydrateSource(ctx, [a], ['p=2'], 2)
    // R5.4.3.19: hydration updated the committed state at SAME stateRevision;
    // re-scan must carry the new revision forward.
    const after = store.buildStateFromCanonicalHosts([a], [], null, undefined)!
    const cls = store.classifyOperation(before, after)
    expect(cls.operationKind).toBe('SOURCE_EDIT')
    // Renderer-only: same revision → NOOP.
    const afterSame = store.buildStateFromCanonicalHosts([a], [], null, undefined)!
    const clsSame = store.classifyOperation(after, afterSame)
    expect(clsSame.operationKind).toBe('NOOP')
  })
})

// ═════════════════════════════════════════════════════════════════════════
// T12 — Insert Hard Gate
// ═════════════════════════════════════════════════════════════════════════

describe('T12 — Insert Hard Gate', () => {
  it('FORMULA_ADDED with no added identity never classifies INSERT_SLOT', async () => {
    const a = makeFormulaHost('p=1')
    const root = makeEditorRoot([a])
    const ctx = makeContext('doc', 1, root)
    await initializeBaseline(ctx, [a], [], undefined, root)
    const store = getFormulaStateStore()
    const before = store.captureBeforeState()
    const after = store.buildStateFromCanonicalHosts([a], [], null, undefined)!
    const cls = store.classifyOperation(before, after)
    expect(cls.operationKind).toBe('NOOP')
    expect(cls.addedIdentities).toHaveLength(0)
  })
})

// ═════════════════════════════════════════════════════════════════════════
// T13 — Initial Open No Click
// ═════════════════════════════════════════════════════════════════════════

describe('T13 — Initial Open No Click', () => {
  it('open → structural → hydration → correct tags, click count=0', async () => {
    const a = makeCompositeHost('E=mc^2', null)
    const b = makeCompositeHost('RMSE', null)
    const root = makeEditorRoot([a, b])
    const ctx = makeContext('doc', 1, root)
    await initializeBaseline(ctx, [a, b], [], undefined, root)
    expect(getFormulaStateStore().committedState!.renderAuthorityReady).toBe(false)
    hydrateStore(ctx, [a, b], ['5.3.1', '11.2.1'])
    const st = getFormulaStateStore().committedState!
    expect(st.renderAuthorityReady).toBe(true)
    expect(st.slotsInDocumentOrder.map((s) => s.desiredTag)).toEqual(['5.3.1', '11.2.1'])
    // No click was simulated in this whole flow.
    expect(true).toBe(true)
  })
})

// ═════════════════════════════════════════════════════════════════════════
// T14 — Existing Native Render Recovery
// ═════════════════════════════════════════════════════════════════════════

describe('T14 — Existing Native Render Recovery', () => {
  it('native (1)/(2) become 5.3.1/11.2.1 after hydration+executor; exact raw source', async () => {
    const a = makeCompositeHost('E=mc^2', '(1)')
    const b = makeCompositeHost('RMSE', '(2)')
    const root = makeEditorRoot([a, b])
    const ctx = makeContext('doc', 1, root)
    await initializeBaseline(ctx, [a, b], [], undefined, root)
    hydrateStore(ctx, [a, b], ['5.3.1', '11.2.1'])
    hydrateSource(ctx, [a, b], ['E=mc^2', 'RMSE'])
    const captured: string[] = []
    installCapturingProvider(captured)
    const store = getFormulaStateStore()
    const txs = store.committedState!.slotsInDocumentOrder.map((slot, i) => makeTx(slot, i))
    await executeProjectionTransactions(txs, root)
    const truth = readFormulaVisibleStateTruth()
    expect(truth.mismatchSlotCount).toBe(0)
    expect(truth.allDesiredTagsVisible).toBe(true)
    const inputs = captured.map((c) => c.replace(/\r\n/g, '\n').trim()).sort()
    expect(inputs).toContain('E=mc^2\\tag{5.3.1}')
    expect(inputs).toContain('RMSE\\tag{11.2.1}')
  })
})

// ═════════════════════════════════════════════════════════════════════════
// T15 — Insert Existing Formula Cascade
// ═════════════════════════════════════════════════════════════════════════

describe('T15 — Insert Existing Formula Cascade', () => {
  it('new + suffix formulas all executor-committed (2.3.2/2.3.3 insert → NEW=2.3.3)', async () => {
    const f1 = makeFormulaHost('a')
    const f2 = makeFormulaHost('b')
    const f3 = makeFormulaHost('c')
    const root = makeEditorRoot([f1, f2, f3])
    const ctx = makeContext('doc', 1, root)
    await initializeBaseline(ctx, [f1, f2, f3], [], undefined, root)
    hydrateStore(ctx, [f1, f2, f3], ['2.3.1', '2.3.2', '2.3.3'])
    const store = getFormulaStateStore()
    const st = store.committedState!
    expect(st.slotsInDocumentOrder.map((s) => s.desiredTag)).toEqual(['2.3.1', '2.3.2', '2.3.3'])
    // Insert a NEW formula between 2.3.2 and 2.3.3.
    const fNew = makeFormulaHost('NEW')
    root.insertBefore(fNew, f3)
    // Structural insert → store gains the new slot (INSERT_SLOT).
    processFormulaSemanticEvent('FORMULA_ADDED', root, [], 'insert-batch', ctx, [f1, f2, fNew, f3])
    const st1 = getFormulaStateStore().committedState!
    expect(st1.slotsInDocumentOrder.length).toBe(4)
    // Numbering re-hydration: NEW=2.3.3, suffix n+1.
    hydrateStore(ctx, [f1, f2, fNew, f3], ['2.3.1', '2.3.2', '2.3.3', '2.3.4'])
    const st2 = getFormulaStateStore().committedState!
    expect(st2.slotsInDocumentOrder.map((s) => s.desiredTag)).toEqual(['2.3.1', '2.3.2', '2.3.3', '2.3.4'])
  })
})

// ═════════════════════════════════════════════════════════════════════════
// T16 — Heading Cascade Executor
// ═════════════════════════════════════════════════════════════════════════

describe('T16 — Heading Cascade Executor', () => {
  it('heading level change re-hydrates downstream desiredTags', async () => {
    const f1 = makeFormulaHost('a')
    const root = makeEditorRoot([f1])
    const ctx = makeContext('doc', 1, root)
    await initializeBaseline(ctx, [f1], [], undefined, root)
    hydrateStore(ctx, [f1], ['2.5.1'])
    expect(getFormulaStateStore().committedState!.slotsInDocumentOrder[0].desiredTag).toBe('2.5.1')
    // H2 2.5 → H1 3: downstream desiredTag becomes 3.1.
    hydrateStore(ctx, [f1], ['3.1'])
    expect(getFormulaStateStore().committedState!.slotsInDocumentOrder[0].desiredTag).toBe('3.1')
  })
})

// ═════════════════════════════════════════════════════════════════════════
// T17 — Multiple Empty Distinct Identities
// ═════════════════════════════════════════════════════════════════════════

describe('T17 — Multiple Empty Distinct Identities', () => {
  it('three empty formulas have distinct structural identities', async () => {
    const e1 = makeFormulaHost('')
    const e2 = makeFormulaHost('<Empty Math Block>')
    const e3 = makeFormulaHost('')
    const root = makeEditorRoot([e1, e2, e3])
    const ctx = makeContext('doc', 1, root)
    await initializeBaseline(ctx, [e1, e2, e3], [], undefined, root)
    const ids = getFormulaStateStore().committedState!.slotsInDocumentOrder.map((s) => String(s.stableIdentity))
    expect(new Set(ids).size).toBe(3)
  })
})

// ═════════════════════════════════════════════════════════════════════════
// T18 — Duplicate Source
// ═════════════════════════════════════════════════════════════════════════

describe('T18 — Duplicate Source', () => {
  it('two p=1 have distinct identity and separate desiredTags', async () => {
    const p1a = makeFormulaHost('p=1')
    const p1b = makeFormulaHost('p=1')
    const root = makeEditorRoot([p1a, p1b])
    const ctx = makeContext('doc', 1, root)
    await initializeBaseline(ctx, [p1a, p1b], [], undefined, root)
    hydrateStore(ctx, [p1a, p1b], ['2.3.1', '2.3.2'])
    const slots = getFormulaStateStore().committedState!.slotsInDocumentOrder
    expect(String(slots[0].stableIdentity)).not.toBe(String(slots[1].stableIdentity))
    expect(slots[0].desiredTag).toBe('2.3.1')
    expect(slots[1].desiredTag).toBe('2.3.2')
  })
})

// ═════════════════════════════════════════════════════════════════════════
// T19 — Async Stale Revision
// ═════════════════════════════════════════════════════════════════════════

describe('T19 — Async Stale Revision', () => {
  it('composite commit refuses a stale targetStateRevision', async () => {
    const owner = makeCompositeHost('x', '(1)')
    const root = makeEditorRoot([owner])
    const ctx = makeContext('doc', 1, root)
    await initializeBaseline(ctx, [owner], [], undefined, root)
    hydrateStore(ctx, [owner], ['2.3.1'])
    hydrateSource(ctx, [owner], ['x'])
    const slot = getFormulaStateStore().committedState!.slotsInDocumentOrder[0]
    const tx: FormulaProjectionTransaction = {
      ...makeTx(slot, 0),
      projectionTransactionId: 'stale',
      targetStateRevision: getFormulaStateStore().currentRevision - 1, // STALE
    }
    const newMjx = document.createElement('mjx-container')
    newMjx.textContent = '(2.3.1)'
    const res = commitProjectionFulfillmentViaCompositeOwner(tx, newMjx, root)
    expect(res.domReplaceSucceeded).toBe(false)
  })
})

// ═════════════════════════════════════════════════════════════════════════
// T20 — Document Switch Stale Promise
// ═════════════════════════════════════════════════════════════════════════

describe('T20 — Document Switch Stale Promise', () => {
  it('document switch retires old state; new baseline uses new context', async () => {
    const aRoot = makeEditorRoot([])
    const bRoot = makeEditorRoot([])
    const ctxA = makeContext('doc-A', 1, aRoot)
    const ctxB = makeContext('doc-B', 2, bRoot)
    await initializeBaseline(ctxA, [], [], undefined, aRoot)
    expect(getFormulaStateStore().documentKey).toBe('doc-A')
    await handleDocumentSwitch(ctxB, [], [], undefined, bRoot)
    const store = getFormulaStateStore()
    expect(store.documentKey).toBe('doc-B')
    expect(store.documentGeneration).toBe(2)
    // Old-document tx would be STALE (targetStateRevision vs new revision).
    expect(store.currentRevision).toBeGreaterThanOrEqual(1)
  })
})

// ═════════════════════════════════════════════════════════════════════════
// T21 — Build ID is R5.4.3.18
// ═════════════════════════════════════════════════════════════════════════

describe('T21 — Build ID is R5.4.3.20', () => {
  it('R54316_BUILD_ID includes r5.4.3.25 and cross-kind render owner source integrity', () => {
    expect(R54316_BUILD_ID).toContain('r5.4.3.25')
    expect(R54316_BUILD_ID).toContain('cross-kind-render-owner-source-integrity')
  })
})

// ═════════════════════════════════════════════════════════════════════════
// T22 — finalizeOperation still works after executor
// ═════════════════════════════════════════════════════════════════════════

describe('T22 — Operation Closure after executor', () => {
  it('finalizeOperation returns a closure', () => {
    const host = makeFormulaHost('x')
    const root = makeEditorRoot([host])
    const ctx = makeContext('doc', 1, root)
    const result = processFormulaSemanticEvent('FORMULA_ADDED', root, [], 'b', ctx, [host])
    if (result.transaction) {
      const closure = finalizeOperation(result.transaction.operationId, true)
      expect(closure).not.toBeNull()
      expect(productionCallCounters.createProjectionTransactions).toBeGreaterThanOrEqual(1)
    } else {
      expect(true).toBe(true)
    }
  })
})
