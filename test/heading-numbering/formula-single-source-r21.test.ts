// @vitest-environment jsdom
/**
 * R5.4.3.21 Single Source Authority + Stale Projection Barrier + Visible Closure.
 * R21-01..R21-15 per:
 *   trae-formula-single-source-stale-projection-visible-closure-v2.5.7-r5.4.3.21.md
 *
 * The critical scenarios drive the REAL MathJax.tex2svgPromise wrapper entry
 * (handleTex2svgPreCall) + source commit barrier + FormulaStateStore +
 * FormulaProjectionExecutor production path — never only the helpers.
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { handleTex2svgPreCall, setTex2svgInjectionContext, resetPreCallCatchupState, reportInjectionFulfillment, type Tex2svgInjectionRuntimeContext, type FormulaRenderAuthorizationPlan, type FormulaRenderAuthorizationPlanEntry } from '../../src/heading-numbering/mathjax-tex2svg-tag-injection'
import {
  initializeBaseline,
  hydrateNumberingAuthorityIntoFormulaStateStore,
  processFormulaSemanticEvent,
  executeProjectionTransactions,
  commitProjectionFulfillmentViaCompositeOwner,
  readFormulaVisibleStateTruth,
  validateProjectionSourceFreshness,
  readVisibleBodyTruth,
  editorRootTokenFor,
  productionCallCounters,
} from '../../src/heading-numbering/formula-state-machine-wiring'
import { createOperationClosure, markSemanticCommitted, resetOperationClosureState } from '../../src/heading-numbering/formula-operation-closure'
import {
  getFormulaStateStore,
  resetFormulaStateStore,
  type FormulaRuntimeContext,
  type CanonicalFormulaSlot,
  type FormulaProjectionTransaction,
  type FormulaOperationTransaction,
  type CommittedFormulaDocumentState,
} from '../../src/heading-numbering/formula-state-store'
import { setOriginalTex2svgPromise } from '../../src/heading-numbering/formula-render-projection'
import { simpleHash, normalizeTexSource, normalizeTyporaFormulaRenderInput } from '../../src/heading-numbering/formula-tex-source-verifier'

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

/** Build a full projection tx from a committed slot (mirrors production executor). */
function makeTx(slot: CanonicalFormulaSlot, i: number, operationId = 'op-r21'): FormulaProjectionTransaction {
  return {
    projectionTransactionId: `r21-tx-${i}`,
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

/** Fake provider: renders body TeX + native (tag) — realistic MJX output. */
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
  resetPreCallCatchupState()
  setTex2svgInjectionContext(null)
  for (const k of Object.keys(productionCallCounters)) {
    (productionCallCounters as Record<string, number>)[k] = 0
  }
  cleanupRoots()
})

// ═════════════════════════════════════════════════════════════════════════
// R21-01 — Real Typora empty sentinel normalization
// ═════════════════════════════════════════════════════════════════════════

describe('R21-01 — Typora <Empty \\space Math \\space Block> sentinel normalization', () => {
  it('sentinel never enters raw TeX; slot becomes KNOWN_EMPTY', () => {
    const h1 = makeHost('p=1')
    const h2 = makeHost('q=1')
    const root = makeEditorRoot([h1, h2])
    const ctx = makeContext('doc', 1, root)
    return baselineTwoFormulas(ctx, root, [h1, h2]).then(() => {
      const hNew = makeHost('<Empty \\space Math \\space Block>', true)
      root.appendChild(hNew)
      const plan = makePlan([h1, h2], '', '5.3.3')
      setTex2svgInjectionContext(makeRuntimeContext(root, plan))

      // Direct normalization unit: the sentinel maps to EMPTY base TeX.
      const norm = normalizeTyporaFormulaRenderInput('<Empty \\space Math \\space Block>')
      expect(norm.sentinelMatched).toBe(true)
      expect(norm.normalizedSourceState).toBe('EMPTY')
      expect(norm.normalizedBaseRawSource).toBe('')

      const result = handleTex2svgPreCall(['<Empty \\space Math \\space Block>'], null, 'test-stack')
      expect(result.decision).toBe('AUTHORIZED')
      const slot = getFormulaStateStore().lookupCommittedSlotByHost(hNew)!
      expect(slot.sourceState).toBe('EMPTY')
      expect(slot.sourceAuthorityKind).toBe('KNOWN_EMPTY')
      expect(slot.authoritativeRawSource).toBe('')
      expect(slot.authoritativeRawSource).not.toContain('Empty')
      expect(slot.desiredTag).toBe('5.3.3')
    })
  })
})

// ═════════════════════════════════════════════════════════════════════════
// R21-02 — Real user input advances the SINGLE source revision (p→p=→p=1)
// ═════════════════════════════════════════════════════════════════════════

describe('R21-02 — User-input source commit advances ONE revision per delta', () => {
  it('p → p= → p=1 through the wrapper; explicitInputObserved=true', () => {
    const h1 = makeHost('p=1')
    const h2 = makeHost('q=1')
    const root = makeEditorRoot([h1, h2])
    const ctx = makeContext('doc', 1, root)
    return baselineTwoFormulas(ctx, root, [h1, h2]).then(() => {
      const hNew = makeHost('', true)
      root.appendChild(hNew)
      const plan = makePlan([h1, h2], '', '5.3.3')
      setTex2svgInjectionContext(makeRuntimeContext(root, plan))

      // 1) EMPTY sentinel first call.
      handleTex2svgPreCall(['<Empty Math Block>'], null, 's')
      const store = getFormulaStateStore()
      const s0 = store.lookupCommittedSlotByHost(hNew)!
      expect(s0.sourceState).toBe('EMPTY')
      const rev0 = s0.authoritativeSourceRevision

      // 2) p
      handleTex2svgPreCall(['p'], null, 's')
      const s1 = store.lookupCommittedSlotByHost(hNew)!
      expect(s1.authoritativeRawSource).toBe('p')
      expect(s1.sourceState).toBe('NONEMPTY')
      const rev1 = s1.authoritativeSourceRevision
      expect(rev1).toBe((rev0 ?? 0) + 1)

      // 3) p=
      handleTex2svgPreCall(['p='], null, 's')
      const s2 = store.lookupCommittedSlotByHost(hNew)!
      expect(s2.authoritativeRawSource).toBe('p=')
      expect(s2.authoritativeSourceRevision).toBe(rev1 + 1)

      // 4) p=1
      handleTex2svgPreCall(['p=1'], null, 's')
      const s3 = store.lookupCommittedSlotByHost(hNew)!
      expect(s3.authoritativeRawSource).toBe('p=1')
      expect(s3.authoritativeSourceRevision).toBe(rev1 + 2)
      expect(s3.desiredTag).toBe('5.3.3')
      // Real user edits — never renderer-triggered.
      expect(productionCallCounters.userSourceEditCount).toBeGreaterThanOrEqual(3)
      expect(productionCallCounters.rendererTriggeredSourceEditCount).toBe(0)
    })
  })
})

// ═════════════════════════════════════════════════════════════════════════
// R21-03 — Single source revision authority (no second parallel truth)
// ═════════════════════════════════════════════════════════════════════════

describe('R21-03 — Single source revision authority', () => {
  it('slot revision is the ONLY revision; idempotent re-render does not advance', () => {
    const h1 = makeHost('p=1')
    const h2 = makeHost('q=1')
    const root = makeEditorRoot([h1, h2])
    const ctx = makeContext('doc', 1, root)
    return baselineTwoFormulas(ctx, root, [h1, h2]).then(() => {
      const hNew = makeHost('p', true)
      root.appendChild(hNew)
      const plan = makePlan([h1, h2], 'p', '5.3.3')
      setTex2svgInjectionContext(makeRuntimeContext(root, plan))
      handleTex2svgPreCall(['p'], null, 's')
      const rev1 = getFormulaStateStore().lookupCommittedSlotByHost(hNew)!.authoritativeSourceRevision
      // Same-hash re-render (Typora repaints the same source): NO revision advance.
      handleTex2svgPreCall(['p'], null, 's')
      const rev2 = getFormulaStateStore().lookupCommittedSlotByHost(hNew)!.authoritativeSourceRevision
      expect(rev2).toBe(rev1)
      expect(productionCallCounters.sourceAuthorityDivergenceCount).toBe(0)
    })
  })
})

// ═════════════════════════════════════════════════════════════════════════
// R21-04/05 — Projection Source Freshness Barrier
// ═════════════════════════════════════════════════════════════════════════

describe('R21-04/05 — PROJECTION-SOURCE-FRESHNESS-BARRIER blocks stale projections', () => {
  it('late stale projection: domReplaceAttempted=false, never overwrites newer render', async () => {
    const h1 = makeHost('p=1')
    const h2 = makeHost('q=1')
    const root = makeEditorRoot([h1, h2])
    const ctx = makeContext('doc', 1, root)
    await baselineTwoFormulas(ctx, root, [h1, h2])
    const hNew = makeHost('a', true, '(3)')
    root.appendChild(hNew)
    const store = getFormulaStateStore()
    store.adoptHostIfMissing(root, hNew, [], ctx)
    // Commit source 'a' (rev 1).
    store.promoteTransitionalCurrentEditSource(hNew, 'a', ctx)
    const slot = store.lookupCommittedSlotByHost(hNew)!
    const staleTx = makeTx(slot, 2)
    // Rapid typing: source advances to 'ab' (rev 2) BEFORE the stale tx commits.
    store.promoteTransitionalCurrentEditSource(hNew, 'ab', ctx)
    const freshness = validateProjectionSourceFreshness(staleTx)
    expect(freshness.domReplaceAllowed).toBe(false)
    expect(freshness.reason).toBe('STALE_SOURCE_REVISION_OR_HASH')
    const newMjx = document.createElement('mjx-container')
    newMjx.textContent = '(5.3.3)'
    const commit = commitProjectionFulfillmentViaCompositeOwner(staleTx, newMjx, root)
    expect(commit.domReplaceAttempted).toBe(false)
    expect(commit.domReplaceSucceeded).toBe(false)
    expect(productionCallCounters.staleProjectionBlockedCount).toBeGreaterThanOrEqual(1)
    // The committed slot was NOT overwritten by the stale projection.
    expect(store.lookupCommittedSlotByHost(hNew)!.authoritativeRawSource).toBe('ab')
  })
})

// ═════════════════════════════════════════════════════════════════════════
// R21-06 — Detached result validation (NONEMPTY source with empty body blocks)
// ═════════════════════════════════════════════════════════════════════════

describe('R21-06 — PROJECTION-DETACHED-RESULT-VALIDATION', () => {
  it('NONEMPTY source + empty-body fulfillment ⇒ FAILED before DOM write', async () => {
    const h1 = makeHost('p=1')
    const h2 = makeHost('q=1')
    const root = makeEditorRoot([h1, h2])
    const ctx = makeContext('doc', 1, root)
    await baselineTwoFormulas(ctx, root, [h1, h2])
    const store = getFormulaStateStore()
    // Provider returns an MJX with tag text but NO body.
    setOriginalTex2svgPromise((tex: unknown) => {
      const node = document.createElement('mjx-container')
      node.textContent = '(5.3.1)'
      return Promise.resolve(node)
    })
    const slot = store.committedState!.slotsInDocumentOrder[0]
    const tx = makeTx(slot, 0)
    const exec = await executeProjectionTransactions([tx], root)
    expect(exec.visibleVerifiedCount).toBe(0)
    expect(exec.failedCount).toBeGreaterThanOrEqual(1)
    expect(productionCallCounters.detachedResultValidationFailureCount).toBeGreaterThanOrEqual(1)
    expect(productionCallCounters.domReplacedCount).toBe(0)
  })
})

// ═════════════════════════════════════════════════════════════════════════
// R21-07 — Visible body truth three states
// ═════════════════════════════════════════════════════════════════════════

describe('R21-07 — FORMULA-VISIBLE-BODY-TRUTH three-state read', () => {
  it('KNOWN_EMPTY / KNOWN_NONEMPTY / UNRESOLVED', async () => {
    const h1 = makeHost('p=1')
    const h2 = makeHost('q=1')
    const root = makeEditorRoot([h1, h2])
    const ctx = makeContext('doc', 1, root)
    await baselineTwoFormulas(ctx, root, [h1, h2])
    const store = getFormulaStateStore()

    // NONEMPTY slot with a real rendered body → KNOWN_NONEMPTY.
    const mjxBody = document.createElement('mjx-container')
    const math = document.createElement('mjx-math')
    math.textContent = 'p=1'
    mjxBody.appendChild(math)
    const label = document.createElement('mjx-label')
    label.textContent = '(5.3.1)'
    mjxBody.appendChild(label)
    h1.appendChild(mjxBody)
    const r1 = readVisibleBodyTruth(h1, store.lookupCommittedSlotByHost(h1)!)
    expect(r1.visibleBodyState).toBe('KNOWN_NONEMPTY')
    expect(r1.decision).not.toBe('FAIL')

    // NONEMPTY slot with NO rendered output → UNRESOLVED (FAIL).
    const r2 = readVisibleBodyTruth(h2, store.lookupCommittedSlotByHost(h2)!)
    expect(r2.visibleBodyState).toBe('UNRESOLVED')
    expect(r2.decision).toBe('FAIL')

    // EMPTY slot + empty MJX → KNOWN_EMPTY (allowed).
    const hEmpty = makeHost('', false)
    const mjxEmpty = document.createElement('mjx-container')
    mjxEmpty.textContent = '(5.3.3)'
    hEmpty.appendChild(mjxEmpty)
    const emptySlot: CanonicalFormulaSlot = {
      ...store.lookupCommittedSlotByHost(h1)!,
      canonicalHost: hEmpty,
      sourceState: 'EMPTY',
      sourceAuthorityKind: 'KNOWN_EMPTY',
      authoritativeRawSource: '',
      desiredTag: '5.3.3',
    }
    const r3 = readVisibleBodyTruth(hEmpty, emptySlot)
    expect(r3.visibleBodyState).toBe('KNOWN_EMPTY')
    expect(r3.decision).not.toBe('FAIL')
  })
})

// ═════════════════════════════════════════════════════════════════════════
// R21-08 — Natural render settlement via ACTUAL_DOM_READ
// ═════════════════════════════════════════════════════════════════════════

describe('R21-08 — FORMULA-NATURAL-RENDER-SOURCE-SETTLEMENT', () => {
  it('first natural render + fulfillment → actual DOM read shows desiredTag', () => {
    const h1 = makeHost('p=1')
    const h2 = makeHost('q=1')
    const root = makeEditorRoot([h1, h2])
    const ctx = makeContext('doc', 1, root)
    return baselineTwoFormulas(ctx, root, [h1, h2]).then(() => {
      const hNew = makeHost('r', true, '(3)')
      root.appendChild(hNew)
      const plan = makePlan([h1, h2], 'r', '5.3.3')
      setTex2svgInjectionContext(makeRuntimeContext(root, plan))
      const result = handleTex2svgPreCall(['r'], null, 's')
      expect(result.decision).toBe('AUTHORIZED')
      // Simulate the fulfillment: Typora resolves with a real MJX body + tag.
      const node = document.createElement('mjx-container')
      const math = document.createElement('mjx-math')
      math.textContent = 'r'
      node.appendChild(math)
      const label = document.createElement('mjx-label')
      label.textContent = '(5.3.3)'
      node.appendChild(label)
      // The fulfilled node is placed by Typora into the preview host.
      const preview = hNew.querySelector('.md-mathjax-preview')!
      const oldMjx = preview.querySelector('mjx-container')
      if (oldMjx) preview.replaceChild(node, oldMjx)
      else preview.appendChild(node)
      reportInjectionFulfillment(result.injection!.callOrdinal, node, true)
      const slot = getFormulaStateStore().lookupCommittedSlotByHost(hNew)!
      const visible = readVisibleBodyTruth(hNew, slot)
      expect(visible.visibleTag).toBe('5.3.3')
      expect(visible.visibleBodyState).toBe('KNOWN_NONEMPTY')
      expect(visible.decision).not.toBe('FAIL')
    })
  })
})

// ═════════════════════════════════════════════════════════════════════════
// R21-09 — STRUCTURAL_HOST_REBIND (edit-mode host A → host B)
// ═════════════════════════════════════════════════════════════════════════

describe('R21-09 — STRUCTURAL_HOST_REBIND preserves logical identity', () => {
  it('host replacement: stableIdentity/source/desiredTag untouched, bindingRevision+1', async () => {
    const h1 = makeHost('p=1')
    const h2 = makeHost('q=1')
    const root = makeEditorRoot([h1, h2])
    const ctx = makeContext('doc', 1, root)
    await baselineTwoFormulas(ctx, root, [h1, h2])
    const store = getFormulaStateStore()
    const s1Before = store.lookupCommittedSlotByHost(h1)!
    const identityBefore = String(s1Before.stableIdentity)
    const sourceBefore = s1Before.authoritativeRawSource
    const revBefore = s1Before.authoritativeSourceRevision
    const tagBefore = s1Before.desiredTag
    const bindingBefore = s1Before.bindingRevision ?? 1

    // Typora edit-mode recreation: h1 is replaced by a NEW element at the same
    // structural position (h1' has a fresh DOM reference / host token).
    const h1p = makeHost('p=1')
    root.replaceChild(h1p, h1)

    const result = processFormulaSemanticEventR21(
      'FORMULA_SOURCE_CHANGED',
      root,
      ctx,
      [h1p, h2],
    )
    expect(result.transaction).not.toBeNull()
    expect(result.transaction!.operationKind).toBe('STRUCTURAL_HOST_REBIND')
    const s1After = store.lookupCommittedSlotByHost(h1p)!
    expect(String(s1After.stableIdentity)).toBe(identityBefore)
    expect(s1After.authoritativeRawSource).toBe(sourceBefore)
    expect(s1After.authoritativeSourceRevision).toBe(revBefore)
    expect(s1After.desiredTag).toBe(tagBefore)
    expect(s1After.bindingRevision).toBe(bindingBefore + 1)
    expect(s1After.canonicalHost).toBe(h1p)
    expect(productionCallCounters.structuralHostRebindCount).toBeGreaterThanOrEqual(1)
  })

  it('semantic NOOP binding is committed — fresh host is never discarded', async () => {
    const h1 = makeHost('p=1')
    const h2 = makeHost('q=1')
    const root = makeEditorRoot([h1, h2])
    const ctx = makeContext('doc', 1, root)
    await baselineTwoFormulas(ctx, root, [h1, h2])
    const store = getFormulaStateStore()
    const identityBefore = String(store.lookupCommittedSlotByHost(h1)!.stableIdentity)
    const h1p = makeHost('p=1')
    root.replaceChild(h1p, h1)
    const result = processFormulaSemanticEventR21('FORMULA_SOURCE_CHANGED', root, ctx, [h1p, h2])
    expect(result.transaction!.operationKind).toBe('STRUCTURAL_HOST_REBIND')
    // Committed: the committed state now points at the fresh host.
    expect(store.committedState!.slotByStableIdentity.get(identityBefore)!.canonicalHost).toBe(h1p)
    expect(String(store.lookupCommittedSlotByHost(h1p)!.stableIdentity)).toBe(identityBefore)
  })
})

// ═════════════════════════════════════════════════════════════════════════
// R21-10 — CLOSURE-REVISION-AUTHORITY (stale revision closure never PASS)
// ═════════════════════════════════════════════════════════════════════════

describe('R21-10 — CLOSURE-REVISION-AUTHORITY', () => {
  it('stale closure (target != current revision) finalizes FAIL', async () => {
    const h1 = makeHost('p=1')
    const h2 = makeHost('q=1')
    const root = makeEditorRoot([h1, h2])
    const ctx = makeContext('doc', 1, root)
    await baselineTwoFormulas(ctx, root, [h1, h2])
    const store = getFormulaStateStore()
    const stateRevision = store.currentRevision

    // Build a closure bound to the CURRENT revision (the op that would commit
    // at stateRevision). The store then advances past it → STALE at finalize.
    const emptyDoc: CommittedFormulaDocumentState = {
      stateRevision,
      documentKey: 'doc',
      documentGeneration: 1,
      editorRootToken: 1,
      headingStateRevision: 0,
      slotsInDocumentOrder: [],
      slotByStableIdentity: new Map(),
      semanticSignature: 'empty',
      committedAtOperationId: null,
    }
    const tx: FormulaOperationTransaction = {
      operationId: 'r21-stale-closure',
      mutationBatchId: 'r21',
      beforeStateRevision: stateRevision,
      beforeState: emptyDoc,
      afterCandidate: { ...emptyDoc, stateRevision: stateRevision + 1 },
      operationKind: 'SOURCE_EDIT',
      addedStableIdentities: [],
      removedStableIdentities: [],
      survivingStableIdentities: [],
      primaryStableIdentity: null,
      dependencyFrontier: null,
      affectedStableIdentities: [],
      targetStateRevision: stateRevision,
      status: 'SEMANTIC_COMMITTED',
    }
    createOperationClosure(tx, 0)
    markSemanticCommitted()
    // Store advances past the closure target BEFORE finalize — via a direct
    // NOOP commit (a processFormulaSemanticEvent call would overwrite the
    // singleton closure state).
    const before2 = store.captureBeforeState()
    const after2 = store.buildStateFromCanonicalHosts([h1, h2], [], null, undefined)!
    store.commitOperation({
      operationId: 'r21-advance-revision',
      mutationBatchId: 'r21',
      beforeStateRevision: before2.stateRevision,
      beforeState: before2,
      afterCandidate: after2,
      operationKind: 'NOOP',
      addedStableIdentities: [],
      removedStableIdentities: [],
      survivingStableIdentities: [],
      primaryStableIdentity: null,
      dependencyFrontier: null,
      affectedStableIdentities: [],
      targetStateRevision: before2.stateRevision + 1,
      status: 'CAPTURED',
    })
    expect(store.currentRevision).toBeGreaterThan(stateRevision)
    // The stale closure (bound to stateRevision) must NEVER PASS. Going through
    // the wiring finalizeOperation (which applies CLOSURE-REVISION-AUTHORITY).
    const { finalizeOperation } = await import('../../src/heading-numbering/formula-state-machine-wiring')
    const closure = finalizeOperation('r21-stale-closure', true)
    expect(closure).not.toBeNull()
    expect(closure!.decision).toBe('FAIL')
    expect(closure!.reason).toContain('STALE_CLOSURE_REVISION')
    expect(productionCallCounters.staleClosurePassCount).toBeGreaterThanOrEqual(1)
  })
})

// ═════════════════════════════════════════════════════════════════════════
// R21-11 — Full flow: EMPTY sentinel → p → p= → p=1 → exit edit → background
//          projection → final actual DOM truth
// ═════════════════════════════════════════════════════════════════════════

describe('R21-11 — EMPTY→p→p=→p=1→exit-edit→projection→final DOM truth', () => {
  it('single source revision drives the whole lifecycle; final DOM matches 5.3.3', async () => {
    const h1 = makeHost('p=1', false, '(1)')
    const h2 = makeHost('q=1', false, '(2)')
    const root = makeEditorRoot([h1, h2])
    const ctx = makeContext('doc', 1, root)
    await baselineTwoFormulas(ctx, root, [h1, h2])
    const store = getFormulaStateStore()

    // 1) New EMPTY formula (real Typora sentinel) appears in edit mode.
    const hEdit = makeHost('<Empty \\space Math \\space Block>', true, '(3)')
    root.appendChild(hEdit)
    const plan = makePlan([h1, h2], '', '5.3.3')
    setTex2svgInjectionContext(makeRuntimeContext(root, plan))
    let res = handleTex2svgPreCall(['<Empty \\space Math \\space Block>'], null, 's')
    expect(res.decision).toBe('AUTHORIZED')
    let slot = store.lookupCommittedSlotByHost(hEdit)!
    expect(slot.sourceState).toBe('EMPTY')
    expect(slot.desiredTag).toBe('5.3.3')

    // 2) Typing p → p= → p=1 advances the SINGLE revision.
    handleTex2svgPreCall(['p'], null, 's')
    handleTex2svgPreCall(['p='], null, 's')
    handleTex2svgPreCall(['p=1'], null, 's')
    slot = store.lookupCommittedSlotByHost(hEdit)!
    expect(slot.authoritativeRawSource).toBe('p=1')
    const revTyped = slot.authoritativeSourceRevision

    // 3) Exit edit mode: Typora replaces the editing host with a preview host.
    const hPreview = makeHost('p=1', false, '(3)')
    root.replaceChild(hPreview, hEdit)
    const rebind = processFormulaSemanticEventR21('FORMULA_SOURCE_CHANGED', root, ctx, [h1, h2, hPreview])
    // Logical identity/source/tag survive the host rebind.
    expect(rebind.transaction!.operationKind).toBe('STRUCTURAL_HOST_REBIND')
    slot = store.lookupCommittedSlotByHost(hPreview)!
    expect(slot.authoritativeRawSource).toBe('p=1')
    expect(slot.authoritativeSourceRevision).toBe(revTyped)
    expect(slot.desiredTag).toBe('5.3.3')

    // 4) Background projection executor fixes native tags for ALL managed slots.
    const captured: string[] = []
    installCapturingProvider(captured)
    const txs = store.committedState!.slotsInDocumentOrder.map((s, i) => makeTx(s, i))
    const exec = await executeProjectionTransactions(txs, root)
    expect(exec.visibleVerifiedCount).toBe(3)
    expect(exec.failedCount).toBe(0)

    // 5) Final actual DOM truth.
    const truth = readFormulaVisibleStateTruth()
    expect(truth.allDesiredTagsVisible).toBe(true)
    expect(truth.nativeManagedTagCount).toBe(0)
    const visible = readVisibleBodyTruth(hPreview, store.lookupCommittedSlotByHost(hPreview)!)
    expect(visible.visibleTag).toBe('5.3.3')
    expect(visible.visibleBodyState).toBe('KNOWN_NONEMPTY')
    expect(visible.decision).not.toBe('FAIL')
  })
})

// ═════════════════════════════════════════════════════════════════════════
// R21-12 — Rapid typing + late stale projection must not corrupt visibility
// ═════════════════════════════════════════════════════════════════════════

describe('R21-12 — Rapid typing + late stale projection', () => {
  it('stale tx for an earlier revision is BLOCKED; current source stays authoritative', async () => {
    const h1 = makeHost('p=1')
    const h2 = makeHost('q=1')
    const root = makeEditorRoot([h1, h2])
    const ctx = makeContext('doc', 1, root)
    await baselineTwoFormulas(ctx, root, [h1, h2])
    const store = getFormulaStateStore()
    const hNew = makeHost('x', true, '(3)')
    root.appendChild(hNew)
    store.adoptHostIfMissing(root, hNew, [], ctx)

    // Rapid typing: x → xy → xyz (revisions 1,2,3).
    store.promoteTransitionalCurrentEditSource(hNew, 'x', ctx)
    store.promoteTransitionalCurrentEditSource(hNew, 'xy', ctx)
    store.promoteTransitionalCurrentEditSource(hNew, 'xyz', ctx)
    const slot = store.lookupCommittedSlotByHost(hNew)!
    expect(slot.authoritativeRawSource).toBe('xyz')

    // A projection was dispatched for the EARLIER 'xy' revision.
    const staleSlot: CanonicalFormulaSlot = { ...slot, authoritativeRawSource: 'xy', authoritativeSourceRevision: (slot.authoritativeSourceRevision ?? 3) - 1, authoritativeSourceHash: simpleHash(normalizeTexSource('xy')) }
    const staleTx = makeTx(staleSlot, 2)
    const freshness = validateProjectionSourceFreshness(staleTx)
    expect(freshness.domReplaceAllowed).toBe(false)
    const commit = commitProjectionFulfillmentViaCompositeOwner(staleTx, document.createElement('mjx-container'), root)
    expect(commit.domReplaceAttempted).toBe(false)
    expect(commit.reason).toBe('STALE_SOURCE_REVISION_OR_HASH')
    // The committed slot still holds the CURRENT source.
    expect(store.lookupCommittedSlotByHost(hNew)!.authoritativeRawSource).toBe('xyz')
    expect(productionCallCounters.staleProjectionBlockedCount).toBeGreaterThanOrEqual(1)
    expect(productionCallCounters.domReplacedCount).toBe(0)
  })
})

// ═════════════════════════════════════════════════════════════════════════
// R21-13 — Duplicate source: alignment NEVER merges by source equality
// ═════════════════════════════════════════════════════════════════════════

describe('R21-13 — Duplicate source distinct identities', () => {
  it('two same-source formulas keep distinct structural identities across re-scans', async () => {
    const a = makeHost('p=1')
    const b = makeHost('p=1')
    const root = makeEditorRoot([a, b])
    const ctx = makeContext('doc', 1, root)
    await initializeBaseline(ctx, [a, b], [], undefined, root)
    const store = getFormulaStateStore()
    const idA = String(store.lookupCommittedSlotByHost(a)!.stableIdentity)
    const idB = String(store.lookupCommittedSlotByHost(b)!.stableIdentity)
    expect(idA).not.toBe(idB)
    // Re-scan (mutation batch) — identities must NOT collapse via source match.
    const r = processFormulaSemanticEventR21('FORMULA_SOURCE_CHANGED', root, ctx, [a, b])
    expect(r.transaction).toBeNull() // NOOP — zero identity churn
    expect(String(store.lookupCommittedSlotByHost(a)!.stableIdentity)).toBe(idA)
    expect(String(store.lookupCommittedSlotByHost(b)!.stableIdentity)).toBe(idB)
  })
})

// ═════════════════════════════════════════════════════════════════════════
// R21-14 — Insert suffix invalidation (insert between 2.3.2 and 2.3.3)
// ═════════════════════════════════════════════════════════════════════════

describe('R21-14 — Insert suffix invalidation', () => {
  it('new formula + suffix both get fresh desiredTags and enter projection', async () => {
    const f1 = makeHost('a')
    const f2 = makeHost('b')
    const root = makeEditorRoot([f1, f2])
    const ctx = makeContext('doc', 1, root)
    await initializeBaseline(ctx, [f1, f2], [], undefined, root)
    const store = getFormulaStateStore()
    // Numbering hydrate 2.3.1 / 2.3.2.
    hydrateNumberingAuthorityIntoFormulaStateStore({
      documentKey: ctx.documentKey,
      generation: ctx.documentGeneration,
      editorRoot: ctx.editorRoot,
      editorRootToken: ctx.editorRootToken,
      entries: [
        { canonicalHost: f1, chapterOrdinal: 2, sectionOrdinal: 3, subsectionOrdinal: null, sequenceValue: 1, scopeKey: 'ch-2.sec-3', desiredTag: '2.3.1', managedForNumbering: true },
        { canonicalHost: f2, chapterOrdinal: 2, sectionOrdinal: 3, subsectionOrdinal: null, sequenceValue: 2, scopeKey: 'ch-2.sec-3', desiredTag: '2.3.2', managedForNumbering: true },
      ],
      headingRevision: 1,
      numberingPlanRevision: 1,
    })
    // Insert new formula between f1 and f2 → suffix f2 becomes 2.3.3.
    const fNew = makeHost('c')
    root.insertBefore(fNew, f2)
    const overrides = new Map<HTMLElement, string | null>([
      [f1, '2.3.1'],
      [fNew, '2.3.2'],
      [f2, '2.3.3'],
    ])
    const { processFormulaSemanticEvent: pse } = await import('../../src/heading-numbering/formula-state-machine-wiring')
    const result = pse('FORMULA_ADDED', root, [], 'insert-suffix', ctx, [f1, fNew, f2], overrides)
    expect(result.transaction).not.toBeNull()
    expect(result.transaction!.operationKind).toBe('INSERT_SLOT')
    const slotNew = store.lookupCommittedSlotByHost(fNew)!
    const slotF2 = store.lookupCommittedSlotByHost(f2)!
    expect(slotNew.desiredTag).toBe('2.3.2')
    // R5.4.3.21 P0-I/J: survivor override applied in the SAME commit.
    expect(slotF2.desiredTag).toBe('2.3.3')
    const tags = result.projectionTransactions.map((t) => t.desiredTag)
    expect(tags).toContain('2.3.2')
    expect(tags).toContain('2.3.3')
  })
})

// ═════════════════════════════════════════════════════════════════════════
// R21-15 — Heading cascade triggers full-document frontier
// ═════════════════════════════════════════════════════════════════════════

describe('R21-15 — Heading cascade dependency frontier', () => {
  it('HEADING_STRUCTURE_CHANGE → frontier covers document end; all formulas affected', async () => {
    const a = makeHost('a')
    const b = makeHost('b')
    const root = makeEditorRoot([a, b])
    const ctx = makeContext('doc', 1, root)
    const store = getFormulaStateStore()
    store.bindRuntimeContext(ctx)
    const after = store.buildStateFromCanonicalHosts([a, b], [], null, undefined)!
    const before = store.captureBeforeState()
    // Force a heading structure revision delta between before and after.
    const beforeWithHeading: typeof before = { ...before, headingStateRevision: 1 }
    const afterWithHeading: typeof after = { ...after, headingStateRevision: 2 }
    const cls = store.classifyOperation(beforeWithHeading, afterWithHeading)
    expect(cls.operationKind).toBe('HEADING_STRUCTURE_CHANGE')
    const frontier = store.computeDependencyFrontier(cls.operationKind, cls.addedIdentities, cls.removedIdentities, cls.survivingIdentities, beforeWithHeading, afterWithHeading)
    expect(frontier).not.toBeNull()
    expect(frontier!.startDocumentOrder).toBe(0)
    const lastOrder = after.slotsInDocumentOrder[after.slotsInDocumentOrder.length - 1].documentOrder
    expect(frontier!.endDocumentOrder).toBe(lastOrder)
    expect(frontier!.affectedStableIdentities.length).toBe(2)
  })
})

// ── Local helper: drive processFormulaSemanticEvent with a runtime context ──

function processFormulaSemanticEventR21(
  eventHint: string,
  root: HTMLElement,
  ctx: FormulaRuntimeContext,
  hosts: HTMLElement[],
): ReturnType<typeof processFormulaSemanticEvent> {
  return processFormulaSemanticEvent(eventHint, root, [], `r21-${Date.now()}`, ctx, hosts)
}
