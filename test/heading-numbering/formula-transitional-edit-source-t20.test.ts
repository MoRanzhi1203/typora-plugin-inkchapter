// @vitest-environment jsdom
/**
 * R5.4.3.20 Transitional Edit Source + Same-Call Closure tests.
 * T20-01..T20-15 (critical subset) per:
 *   trae-formula-transitional-edit-source-same-call-closure-v2.5.7-r5.4.3.20.md
 *
 * First-call scenarios drive the REAL MathJax.tex2svgPromise wrapper entry
 * (handleTex2svgPreCall) — never only the transitional helpers.
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { handleTex2svgPreCall, setTex2svgInjectionContext, resetPreCallCatchupState, type Tex2svgInjectionRuntimeContext, type FormulaRenderAuthorizationPlan, type FormulaRenderAuthorizationPlanEntry } from '../../src/heading-numbering/mathjax-tex2svg-tag-injection'
import {
  initializeBaseline,
  hydrateNumberingAuthorityIntoFormulaStateStore,
  replaySourceReadyProjection,
  registerPendingSourceReadyProjection,
  acquireRenderOwnership,
  releaseRenderOwnership,
  editorRootTokenFor,
  productionCallCounters,
  R54316_BUILD_ID,
} from '../../src/heading-numbering/formula-state-machine-wiring'
import {
  getFormulaStateStore,
  resetFormulaStateStore,
  type FormulaRuntimeContext,
  type FormulaProjectionTransaction,
} from '../../src/heading-numbering/formula-state-store'
import { resetOperationClosureState } from '../../src/heading-numbering/formula-operation-closure'
import { simpleHash, normalizeTexSource } from '../../src/heading-numbering/formula-tex-source-verifier'

let nextToken = 1

/** Typora-like block formula host: source div + optional preview MJX. */
function makeHost(source: string, isEditing = false, previewTag: string | null = null): HTMLElement {
  const owner = document.createElement('div')
  owner.className = 'md-math-block' + (isEditing ? ' md-focus' : '')
  const src = document.createElement('div')
  src.className = 'md-rawblock-container'
  src.textContent = source
  owner.appendChild(src)
  if (previewTag !== null) {
    const p = document.createElement('div')
    p.className = 'md-mathjax-preview'
    const mjx = document.createElement('mjx-container')
    mjx.textContent = previewTag
    p.appendChild(mjx)
    owner.appendChild(p)
  }
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
  return { documentKey: docKey, documentGeneration: gen, editorRoot, editorRootToken: editorRootTokenFor(editorRoot) }
}

/** Baseline: 2 existing formulas numbered 5.3.1 / 5.3.2 with source ready. */
async function baselineTwoFormulas(ctx: FormulaRuntimeContext, root: HTMLElement, hosts: HTMLElement[]): Promise<void> {
  await initializeBaseline(ctx, hosts, [], undefined, root)
  hydrateNumberingAuthorityIntoFormulaStateStore({
    documentKey: ctx.documentKey,
    generation: ctx.documentGeneration,
    editorRoot: ctx.editorRoot,
    editorRootToken: ctx.editorRootToken,
    entries: hosts.map((h, i) => ({
      canonicalHost: h,
      chapterOrdinal: 5,
      sectionOrdinal: 3,
      subsectionOrdinal: null,
      sequenceValue: i + 1,
      scopeKey: 'ch-5.sec-3',
      desiredTag: i === 0 ? '5.3.1' : '5.3.2',
      managedForNumbering: true,
    })),
    headingRevision: 1,
    numberingPlanRevision: 1,
  })
  const store = getFormulaStateStore()
  hosts.forEach((h, i) => {
    store.hydrateFormulaSourceAuthority({
      documentKey: ctx.documentKey,
      generation: ctx.documentGeneration,
      editorRootToken: ctx.editorRootToken,
      canonicalHost: h,
      source: {
        sourceState: 'NONEMPTY',
        sourceAuthorityKind: 'AUTHORITATIVE_SOURCE',
        authoritativeRawSource: i === 0 ? 'p=1' : 'q=1',
        authoritativeSourceHash: simpleHash(i === 0 ? 'p=1' : 'q=1'),
        authoritativeSourceRevision: 1,
      },
    })
  })
}

function makePlanEntry(index: number, source: string, desiredTag: string, identity: number | null): FormulaRenderAuthorizationPlanEntry {
  const hash = simpleHash(normalizeTexSource(source))
  return {
    documentKey: 'doc',
    documentPath: 'doc.md',
    documentSourceRevision: 1,
    documentSourceSha256: 'sha',
    planRevision: 1,
    planCreatedAtGeneration: 1,
    formulaIndex: index,
    formulaHostTokenAtPlanTime: 0,
    desiredTag,
    expectedVisibleLabel: `(${desiredTag})`,
    chapterOrdinal: 5,
    sectionOrdinal: 3,
    sequenceValue: index + 1,
    sourceKind: 'RAWBLOCK_SOURCE_CONTAINER',
    rawSourceLength: source.length,
    normalizedSourceLength: source.length,
    normalizedSourceHash: hash,
    normalizedSourcePrefix: source,
    explicitTagControl: false,
    managedEligible: true,
    authorizationState: 'READY',
    stableFormulaIdentity: identity,
    formulaContentRevision: 1,
    authoritativeSourceHash: hash,
  }
}

function makePlan(hosts: HTMLElement[], newSource: string | null, newDesiredTag: string | null): FormulaRenderAuthorizationPlan {
  const entries = hosts.map((h, i) => makePlanEntry(i, i === 0 ? 'p=1' : 'q=1', i === 0 ? '5.3.1' : '5.3.2', i + 1))
  if (newSource !== null) {
    entries.push(makePlanEntry(2, newSource, newDesiredTag ?? '5.3.3', 3))
  }
  return {
    documentKey: 'doc',
    documentSourceSha256: 'sha',
    documentSourceRevision: 1,
    planRevision: 1,
    planLiveFormulaRevision: 1,
    planSemanticSignature: 'sig',
    entries,
  }
}

function makeRuntimeContext(root: HTMLElement, plan: FormulaRenderAuthorizationPlan): Tex2svgInjectionRuntimeContext {
  return {
    enabled: true,
    plan,
    getWorkspaceActivePath: () => 'doc.md',
    getDocumentKey: () => 'doc',
    getDocumentSourceSha256: () => 'sha',
    getEditorRoot: () => root,
    getCurrentGeneration: () => 1,
    getCurrentLiveFormulaRevision: () => 1,
    getCurrentSemanticSignature: () => 'sig',
    getContextToken: () => 1,
    resolveEditingHostIdentity: () => {
      const editing = root.querySelector('.md-math-block.md-focus')
      if (!editing) return null
      return {
        candidateCount: 1,
        stableFormulaIdentity: 3,
        formulaIndex: 2,
        planEntryFound: true,
        decision: 'CURRENT_EDITING_HOST',
      }
    },
  }
}

beforeEach(() => {
  resetFormulaStateStore()
  resetOperationClosureState()
  resetPreCallCatchupState()
  setTex2svgInjectionContext(null)
  for (const k of Object.keys(productionCallCounters)) {
    (productionCallCounters as Record<string, number>)[k] = 0
  }
  cleanupRoots()
})

// ═════════════════════════════════════════════════════════════════════════
// T20-01 — First char natural render before Store slot exists
// ═════════════════════════════════════════════════════════════════════════

describe('T20-01 — First char natural render before Store slot', () => {
  it('precall adoption → transitional source=t → same-call 5.3.3 injection', () => {
    const h1 = makeHost('p=1')
    const h2 = makeHost('q=1')
    const root = makeEditorRoot([h1, h2])
    const ctx = makeContext('doc', 1, root)
    // async baseline
    return baselineTwoFormulas(ctx, root, [h1, h2]).then(() => {
      // NEW editing formula appears in the DOM; Store has NO slot for it yet.
      const hNew = makeHost('t', true)
      root.appendChild(hNew)
      const plan = makePlan([h1, h2], 't', '5.3.3')
      setTex2svgInjectionContext(makeRuntimeContext(root, plan))

      const result = handleTex2svgPreCall(['t'], null, 'test-stack')

      expect(result.decision).toBe('AUTHORIZED')
      expect(result.injection).not.toBeNull()
      expect(result.injection!.desiredTag).toBe('5.3.3')
      expect(result.injection!.formulaIndex).toBe(2)
      // Store source must be the ORIGINAL raw input — never the injected tag.
      const store = getFormulaStateStore()
      const slot = store.lookupCommittedSlotByHost(hNew)
      expect(slot).not.toBeNull()
      expect(slot!.sourceAuthorityReady).toBe(true)
      expect(slot!.sourceAuthorityKind).toBe('TRANSITIONAL_CURRENT_EDIT')
      expect(slot!.authoritativeRawSource).toBe('t')
      expect(slot!.authoritativeRawSource).not.toContain('\\tag')
      expect(slot!.desiredTag).toBe('5.3.3')
      expect(productionCallCounters.precallSlotAdoptionCount).toBeGreaterThanOrEqual(1)
      expect(productionCallCounters.sameCallAuthorizationSuccessCount).toBeGreaterThanOrEqual(1)
    })
  })
})

// ═════════════════════════════════════════════════════════════════════════
// T20-02 — Empty first natural render before Store slot
// ═════════════════════════════════════════════════════════════════════════

describe('T20-02 — Empty first natural render', () => {
  it('KNOWN_EMPTY + same-call authorization without first char', () => {
    const h1 = makeHost('p=1')
    const h2 = makeHost('q=1')
    const root = makeEditorRoot([h1, h2])
    const ctx = makeContext('doc', 1, root)
    return baselineTwoFormulas(ctx, root, [h1, h2]).then(() => {
      const hNew = makeHost('', true)
      root.appendChild(hNew)
      const plan = makePlan([h1, h2], '', '5.3.3')
      setTex2svgInjectionContext(makeRuntimeContext(root, plan))

      const result = handleTex2svgPreCall([''], null, 'test-stack')
      expect(result.decision).toBe('AUTHORIZED')
      expect(result.injection).not.toBeNull()
      expect(result.injection!.desiredTag).toBe('5.3.3')
      const slot = getFormulaStateStore().lookupCommittedSlotByHost(hNew)
      expect(slot!.sourceState).toBe('EMPTY')
      expect(slot!.sourceAuthorityReady).toBe(true)
      expect(slot!.sourceAuthorityKind).toBe('KNOWN_EMPTY')
      expect(slot!.authoritativeRawSource).toBe('')
    })
  })
})

// ═════════════════════════════════════════════════════════════════════════
// T20-03 — Store slot exists but source UNKNOWN
// ═════════════════════════════════════════════════════════════════════════

describe('T20-03 — Slot exists but source UNKNOWN', () => {
  it('transitional source promotion in same call closes source dimension', async () => {
    const h1 = makeHost('p=1')
    const h2 = makeHost('q=1')
    const hNew = makeHost('t', true)
    const root = makeEditorRoot([h1, h2, hNew])
    const ctx = makeContext('doc', 1, root)
    // Baseline includes the new host but WITHOUT source hydration (UNKNOWN).
    await baselineTwoFormulas(ctx, root, [h1, h2])
    // Adopt the new host structurally (source stays UNKNOWN).
    const plan3 = makePlan([h1, h2], null, null)
    setTex2svgInjectionContext(makeRuntimeContext(root, plan3))
    // structural adoption without source
    const store = getFormulaStateStore()
    store.adoptHostIfMissing(root, hNew, [], ctx)
    expect(store.lookupCommittedSlotByHost(hNew)!.sourceState).toBe('UNKNOWN')

    const plan = makePlan([h1, h2], 't', '5.3.3')
    setTex2svgInjectionContext(makeRuntimeContext(root, plan))
    const result = handleTex2svgPreCall(['t'], null, 'test-stack')
    expect(result.decision).toBe('AUTHORIZED')
    expect(result.injection!.desiredTag).toBe('5.3.3')
    const slot = store.lookupCommittedSlotByHost(hNew)!
    expect(slot.sourceAuthorityReady).toBe(true)
    expect(slot.sourceAuthorityKind).toBe('TRANSITIONAL_CURRENT_EDIT')
  })
})

// ═════════════════════════════════════════════════════════════════════════
// T20-04 — Legacy identity → Store identity rebind
// ═════════════════════════════════════════════════════════════════════════

describe('T20-04 — Legacy identity rebind', () => {
  it('same-call uses Store stable identity (no loss)', async () => {
    const h1 = makeHost('p=1')
    const h2 = makeHost('q=1')
    const hNew = makeHost('t', true)
    const root = makeEditorRoot([h1, h2, hNew])
    const ctx = makeContext('doc', 1, root)
    await baselineTwoFormulas(ctx, root, [h1, h2])
    const plan = makePlan([h1, h2], 't', '5.3.3')
    setTex2svgInjectionContext(makeRuntimeContext(root, plan))
    const result = handleTex2svgPreCall(['t'], null, 'test-stack')
    expect(result.decision).toBe('AUTHORIZED')
    // legacy formulaIndex 2 was rebound to a Store string identity.
    expect(productionCallCounters.identityRebindCount).toBeGreaterThanOrEqual(1)
    expect(productionCallCounters.sameCallStableIdentityMissingCount).toBe(0)
  })
})

// ═════════════════════════════════════════════════════════════════════════
// T20-05 — Never use source equality for identity rebind
// ═════════════════════════════════════════════════════════════════════════

describe('T20-05 — No source-equality identity rebind', () => {
  it('duplicate p=1 formulas keep distinct Store identities', async () => {
    const h1 = makeHost('p=1')
    const h2 = makeHost('p=1')
    const root = makeEditorRoot([h1, h2])
    const ctx = makeContext('doc', 1, root)
    await baselineTwoFormulas(ctx, root, [h1, h2])
    // Both sources equal → distinct identities via structural slot only.
    const store = getFormulaStateStore()
    const s1 = store.lookupCommittedSlotByHost(h1)
    const s2 = store.lookupCommittedSlotByHost(h2)
    expect(String(s1!.stableIdentity)).not.toBe(String(s2!.stableIdentity))
  })
})

// ═════════════════════════════════════════════════════════════════════════
// T20-06 — Natural render before MutationObserver (adoption wins)
// ═════════════════════════════════════════════════════════════════════════

describe('T20-06 — Natural render before MutationObserver', () => {
  it('adoption produces ONE identity; re-scan is NOOP (no duplicate INSERT)', async () => {
    const h1 = makeHost('p=1')
    const h2 = makeHost('q=1')
    const hNew = makeHost('t', true)
    const root = makeEditorRoot([h1, h2, hNew])
    const ctx = makeContext('doc', 1, root)
    await baselineTwoFormulas(ctx, root, [h1, h2])
    const store = getFormulaStateStore()
    const beforeCount = store.committedState!.slotsInDocumentOrder.length
    // Pre-call adoption (simulates tex2svg happening before MutationObserver).
    const adoption = store.adoptHostIfMissing(root, hNew, [], ctx)
    expect(adoption.outcome).toBe('ADOPTED')
    const afterCount = store.committedState!.slotsInDocumentOrder.length
    expect(afterCount).toBe(beforeCount + 1)
    // MutationObserver re-scan: same host → EXISTING_SLOT (NOOP).
    const adoption2 = store.adoptHostIfMissing(root, hNew, [], ctx)
    expect(adoption2.outcome).toBe('EXISTING_SLOT')
    expect(store.committedState!.slotsInDocumentOrder.length).toBe(beforeCount + 1)
  })
})

// ═════════════════════════════════════════════════════════════════════════
// T20-07 — MutationObserver before natural render (existing slot reused)
// ═════════════════════════════════════════════════════════════════════════

describe('T20-07 — MutationObserver before natural render', () => {
  it('existing slot reused; no duplicate adopt', async () => {
    const h1 = makeHost('p=1')
    const h2 = makeHost('q=1')
    const root = makeEditorRoot([h1, h2])
    const ctx = makeContext('doc', 1, root)
    await baselineTwoFormulas(ctx, root, [h1, h2])
    const hNew = makeHost('t', true)
    root.appendChild(hNew)
    // MutationObserver committed the slot first.
    getFormulaStateStore().adoptHostIfMissing(root, hNew, [], ctx)
    const id1 = String(getFormulaStateStore().lookupCommittedSlotByHost(hNew)!.stableIdentity)
    // tex2svg pre-call: adoption path sees EXISTING_SLOT.
    const plan = makePlan([h1, h2], 't', '5.3.3')
    setTex2svgInjectionContext(makeRuntimeContext(root, plan))
    const result = handleTex2svgPreCall(['t'], null, 'test-stack')
    expect(result.decision).toBe('AUTHORIZED')
    expect(result.injection!.desiredTag).toBe('5.3.3')
    const id2 = String(getFormulaStateStore().lookupCommittedSlotByHost(hNew)!.stableIdentity)
    expect(id2).toBe(id1)
  })
})

// ═════════════════════════════════════════════════════════════════════════
// T20-08 — Transitional same raw input idempotent
// ═════════════════════════════════════════════════════════════════════════

describe('T20-08 — Transitional same input idempotent', () => {
  it('same raw input does not advance source revision twice', async () => {
    const h1 = makeHost('p=1')
    const h2 = makeHost('q=1')
    const hNew = makeHost('t', true)
    const root = makeEditorRoot([h1, h2, hNew])
    const ctx = makeContext('doc', 1, root)
    await baselineTwoFormulas(ctx, root, [h1, h2])
    const store = getFormulaStateStore()
    store.adoptHostIfMissing(root, hNew, [], ctx)
    store.promoteTransitionalCurrentEditSource(hNew, 't', ctx)
    const rev1 = store.lookupCommittedSlotByHost(hNew)!.authoritativeSourceRevision
    store.promoteTransitionalCurrentEditSource(hNew, 't', ctx)
    const rev2 = store.lookupCommittedSlotByHost(hNew)!.authoritativeSourceRevision
    expect(rev2).toBe(rev1)
  })
})

// ═════════════════════════════════════════════════════════════════════════
// T20-09 — Real user typing revisions
// ═════════════════════════════════════════════════════════════════════════

describe('T20-09 — Real user typing revisions', () => {
  it('t → t= → t=1 advances revision per real source delta', async () => {
    const h1 = makeHost('p=1')
    const h2 = makeHost('q=1')
    const hNew = makeHost('t', true)
    const root = makeEditorRoot([h1, h2, hNew])
    const ctx = makeContext('doc', 1, root)
    await baselineTwoFormulas(ctx, root, [h1, h2])
    const store = getFormulaStateStore()
    store.adoptHostIfMissing(root, hNew, [], ctx)
    store.promoteTransitionalCurrentEditSource(hNew, 't', ctx)
    const r1 = store.lookupCommittedSlotByHost(hNew)!.authoritativeSourceRevision
    store.promoteTransitionalCurrentEditSource(hNew, 't=', ctx)
    const r2 = store.lookupCommittedSlotByHost(hNew)!.authoritativeSourceRevision
    store.promoteTransitionalCurrentEditSource(hNew, 't=1', ctx)
    const r3 = store.lookupCommittedSlotByHost(hNew)!.authoritativeSourceRevision
    expect(r2).toBe((r1 ?? 0) + 1)
    expect(r3).toBe((r2 ?? 0) + 1)
  })
})

// ═════════════════════════════════════════════════════════════════════════
// T20-12 — BLOCKED_SOURCE_NOT_READY replay (source ready → new tx)
// ═════════════════════════════════════════════════════════════════════════

describe('T20-12 — BLOCKED_SOURCE_NOT_READY replay', () => {
  it('source ready → stale blocked tx retired → replay settles pending', async () => {
    const h1 = makeHost('p=1')
    const h2 = makeHost('q=1')
    const root = makeEditorRoot([h1, h2])
    const ctx = makeContext('doc', 1, root)
    await baselineTwoFormulas(ctx, root, [h1, h2])
    const hNew = makeHost('t', true)
    root.appendChild(hNew)
    const store = getFormulaStateStore()
    store.adoptHostIfMissing(root, hNew, [], ctx)
    // Register a BLOCKED source-ready pending for the new slot.
    const slot = store.lookupCommittedSlotByHost(hNew)!
    const blockedTx: FormulaProjectionTransaction = {
      projectionTransactionId: 'blocked-1',
      operationId: 'op-1',
      targetStateRevision: store.currentRevision,
      stableIdentity: slot.stableIdentity,
      formulaIndex: store.committedState!.slotsInDocumentOrder.indexOf(slot),
      canonicalHost: slot.canonicalHost,
      canonicalHostToken: slot.canonicalHostToken,
      desiredTag: '5.3.3',
      rawSource: '',
      sourceState: 'UNKNOWN',
      authoritativeSourceHash: null,
      authoritativeSourceRevision: null,
      compositeOwner: null,
      previewHost: null,
      oldNativeMjx: null,
      nativeDomMutationCount: 0,
      status: 'BLOCKED_SOURCE_NOT_READY',
    }
    registerPendingSourceReadyProjection(blockedTx)
    expect(store.getPendingSourceReadyProjectionCount()).toBe(1)
    // Source + numbering become ready → replay settles pending.
    store.promoteTransitionalCurrentEditSource(hNew, 't', ctx)
    hydrateNumberingAuthorityIntoFormulaStateStore({
      documentKey: ctx.documentKey,
      generation: ctx.documentGeneration,
      editorRoot: ctx.editorRoot,
      editorRootToken: ctx.editorRootToken,
      entries: [{ canonicalHost: hNew, chapterOrdinal: 5, sectionOrdinal: 3, subsectionOrdinal: null, sequenceValue: 3, scopeKey: 'ch-5.sec-3', desiredTag: '5.3.3', managedForNumbering: true }],
      headingRevision: 1,
      numberingPlanRevision: 1,
    })
    await replaySourceReadyProjection(slot.stableIdentity, root)
    // Pending was settled (retired) even if the replay projection failed (no provider in test).
    expect(store.getPendingSourceReadyProjectionCount()).toBe(0)
  })
})

// ═════════════════════════════════════════════════════════════════════════
// T20-13 — Natural render satisfies blocked pending
// ═════════════════════════════════════════════════════════════════════════

describe('T20-13 — Natural render satisfies blocked pending', () => {
  it('visible tag already correct → SATISFIED_BY_NATURAL_RENDER (no replace)', async () => {
    const h1 = makeHost('p=1')
    const h2 = makeHost('q=1')
    const root = makeEditorRoot([h1, h2])
    const ctx = makeContext('doc', 1, root)
    await baselineTwoFormulas(ctx, root, [h1, h2])
    const hNew = makeHost('t', true, '(5.3.3)')
    root.appendChild(hNew)
    const store = getFormulaStateStore()
    store.adoptHostIfMissing(root, hNew, [], ctx)
    const slot = store.lookupCommittedSlotByHost(hNew)!
    const blockedTx: FormulaProjectionTransaction = {
      projectionTransactionId: 'blocked-2',
      operationId: 'op-2',
      targetStateRevision: store.currentRevision,
      stableIdentity: slot.stableIdentity,
      formulaIndex: store.committedState!.slotsInDocumentOrder.indexOf(slot),
      canonicalHost: slot.canonicalHost,
      canonicalHostToken: slot.canonicalHostToken,
      desiredTag: '5.3.3',
      rawSource: '',
      sourceState: 'UNKNOWN',
      authoritativeSourceHash: null,
      authoritativeSourceRevision: null,
      compositeOwner: null,
      previewHost: null,
      oldNativeMjx: null,
      nativeDomMutationCount: 0,
      status: 'BLOCKED_SOURCE_NOT_READY',
    }
    registerPendingSourceReadyProjection(blockedTx)
    // Source + numbering ready, natural render already shows 5.3.3.
    store.promoteTransitionalCurrentEditSource(hNew, 't', ctx)
    hydrateNumberingAuthorityIntoFormulaStateStore({
      documentKey: ctx.documentKey,
      generation: ctx.documentGeneration,
      editorRoot: ctx.editorRoot,
      editorRootToken: ctx.editorRootToken,
      entries: [{ canonicalHost: hNew, chapterOrdinal: 5, sectionOrdinal: 3, subsectionOrdinal: null, sequenceValue: 3, scopeKey: 'ch-5.sec-3', desiredTag: '5.3.3', managedForNumbering: true }],
      headingRevision: 1,
      numberingPlanRevision: 1,
    })
    await replaySourceReadyProjection(slot.stableIdentity, root)
    expect(store.getPendingSourceReadyProjectionCount()).toBe(0)
    // Exactly one mjx-container remains (no duplicate replacement).
    const mjxs = hNew.querySelectorAll('mjx-container')
    expect(mjxs.length).toBe(1)
  })
})

// ═════════════════════════════════════════════════════════════════════════
// T20-15 — Natural/projection ownership arbitration
// ═════════════════════════════════════════════════════════════════════════

describe('T20-15 — Natural/projection ownership arbitration', () => {
  it('only one commit owner at a time', async () => {
    const h1 = makeHost('p=1')
    const root = makeEditorRoot([h1])
    const ctx = makeContext('doc', 1, root)
    await baselineTwoFormulas(ctx, root, [h1])
    const store = getFormulaStateStore()
    const slot = store.committedState!.slotsInDocumentOrder[0]
    // Natural render owns the slot first.
    expect(acquireRenderOwnership(slot.stableIdentity, 'NATURAL_RENDER', store.currentRevision, 1, null)).toBe(true)
    // A projection for the same slot is refused.
    expect(acquireRenderOwnership(slot.stableIdentity, 'PROJECTION', store.currentRevision, null, 'tx-1')).toBe(false)
    releaseRenderOwnership(slot.stableIdentity)
    // After release, projection can own it.
    expect(acquireRenderOwnership(slot.stableIdentity, 'PROJECTION', store.currentRevision, null, 'tx-1')).toBe(true)
  })
})

// ═════════════════════════════════════════════════════════════════════════
// T20-21/T20-22 — Inline / foreign MathJax pass-through (no Store mutation)
// ═════════════════════════════════════════════════════════════════════════

describe('T20-21/22 — Inline & foreign calls', () => {
  it('inline math never creates a Store block slot', async () => {
    const root = makeEditorRoot([])
    const ctx = makeContext('doc', 1, root)
    await baselineTwoFormulas(ctx, root, [])
    // Inline math host (span.md-math) is not a block formula.
    const inline = document.createElement('span')
    inline.className = 'md-math'
    inline.textContent = '$x+y$'
    root.appendChild(inline)
    const store = getFormulaStateStore()
    expect(store.lookupCommittedSlotByHost(inline)).toBeNull()
  })
})

// ═════════════════════════════════════════════════════════════════════════
// T20-16 — Empty remains source-clean
// ═════════════════════════════════════════════════════════════════════════

describe('T20-16 — Empty source-clean', () => {
  it('empty rawSource never contains sentinel/UI text', async () => {
    const h1 = makeHost('p=1')
    const root = makeEditorRoot([h1])
    const ctx = makeContext('doc', 1, root)
    await baselineTwoFormulas(ctx, root, [h1])
    const hNew = makeHost('<Empty Math Block>', true)
    root.appendChild(hNew)
    const store = getFormulaStateStore()
    store.adoptHostIfMissing(root, hNew, [], ctx)
    store.promoteTransitionalCurrentEditSource(hNew, '', ctx)
    const slot = store.lookupCommittedSlotByHost(hNew)!
    expect(slot.sourceState).toBe('EMPTY')
    expect(slot.authoritativeRawSource).toBe('')
    expect(slot.authoritativeRawSource).not.toContain('Empty')
    expect(slot.authoritativeRawSource).not.toContain('公式')
  })
})

// ═════════════════════════════════════════════════════════════════════════
// T20-18 — Existing initial document regression
// ═════════════════════════════════════════════════════════════════════════

describe('T20-18 — Initial document no-click', () => {
  it('existing formulas keep correct numbering and source', async () => {
    const h1 = makeHost('p=1', false, '(1)')
    const h2 = makeHost('q=1', false, '(2)')
    const root = makeEditorRoot([h1, h2])
    const ctx = makeContext('doc', 1, root)
    await baselineTwoFormulas(ctx, root, [h1, h2])
    const st = getFormulaStateStore().committedState!
    expect(st.slotsInDocumentOrder.map((s) => s.desiredTag)).toEqual(['5.3.1', '5.3.2'])
    expect(st.slotsInDocumentOrder[0].authoritativeRawSource).toBe('p=1')
    expect(st.slotsInDocumentOrder[1].authoritativeRawSource).toBe('q=1')
  })
})

// ═════════════════════════════════════════════════════════════════════════
// Build ID
// ═════════════════════════════════════════════════════════════════════════

describe('T20 Build ID', () => {
  it('R54316_BUILD_ID is the R5.4.3.25 build', () => {
    expect(R54316_BUILD_ID).toBe('inkchapter-formula-cross-kind-render-owner-source-integrity-v2.5.7-r5.4.3.25')
  })
})
