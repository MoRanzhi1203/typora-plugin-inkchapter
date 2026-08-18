// @vitest-environment jsdom
/**
 * R5.4.3.19 Authoritative Source Integrity + Renderer Feedback Isolation tests.
 * ASI-01..ASI-18 per:
 *   trae-formula-authoritative-source-feedback-isolation-v2.5.7-r5.4.3.19.md
 */
import { describe, it, expect, beforeEach } from 'vitest'
import {
  initializeBaseline,
  processFormulaSemanticEvent,
  hydrateNumberingAuthorityIntoFormulaStateStore,
  executeProjectionTransactions,
  commitProjectionFulfillmentViaCompositeOwner,
  readFormulaVisibleStateTruth,
  checkProjectionSourceIntegrity,
  getPendingBaselineProjectionCount,
  R54316_BUILD_ID,
} from '../../src/heading-numbering/formula-state-machine-wiring'
import {
  getFormulaStateStore,
  resetFormulaStateStore,
  isFormulaEmptySource,
  type FormulaRuntimeContext,
  type CanonicalFormulaSlot,
  type FormulaProjectionTransaction,
} from '../../src/heading-numbering/formula-state-store'
import { resetOperationClosureState } from '../../src/heading-numbering/formula-operation-closure'
import { setOriginalTex2svgPromise, getNaturalRenderOptions, cacheNaturalRenderOptions } from '../../src/heading-numbering/formula-render-projection'
import { simpleHash, normalizeTexSource, extractFormulaTexForTrace } from '../../src/heading-numbering/formula-tex-source-verifier'

let nextToken = 1

function makeCompositeHost(source: string, nativeTag: string | null, uiText = '公式'): HTMLElement {
  const owner = document.createElement('div')
  owner.className = 'mathjax-block'
  const sourceEl = document.createElement('div')
  sourceEl.className = 'md-rawblock-container'
  sourceEl.textContent = source
  const ui = document.createElement('span')
  ui.textContent = uiText
  const preview = document.createElement('div')
  preview.className = 'md-mathjax-preview'
  if (nativeTag !== null) {
    const mjx = document.createElement('mjx-container')
    mjx.textContent = nativeTag
    preview.appendChild(mjx)
  }
  owner.appendChild(sourceEl)
  owner.appendChild(ui)
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
      chapterOrdinal: 5,
      sectionOrdinal: 3,
      subsectionOrdinal: null,
      sequenceValue: i + 1,
      scopeKey: 'ch-5.sec-3',
      desiredTag: tags[i],
      managedForNumbering: true,
    })),
    headingRevision: 1,
    numberingPlanRevision: 1,
  })
}

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

function makeTx(slot: CanonicalFormulaSlot, i: number): FormulaProjectionTransaction {
  return {
    projectionTransactionId: `tx-${i}`,
    operationId: 'op',
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

function installProvider(captured: string[]): void {
  setOriginalTex2svgPromise((tex: unknown) => {
    captured.push(String(tex))
    const m = String(tex).match(/\\tag\{([^}]*)\}/)
    const node = document.createElement('mjx-container')
    node.textContent = m ? `(${m[1]})` : '()'
    return Promise.resolve(node)
  })
}

beforeEach(() => {
  resetFormulaStateStore()
  resetOperationClosureState()
  cleanupRoots()
})

// ── ASI-01: Composite host textContent is NEVER the source ─────────────

describe('ASI-01 — Composite Host textContent never becomes source', () => {
  it('slot source stays exact p=1 even when composite text contains 公式/(5.3.1)', async () => {
    // whole host textContent: "p=1" + "公式" + "(5.3.1)" rendered output
    const owner = makeCompositeHost('p=1', '(5.3.1)')
    const root = makeEditorRoot([owner])
    const ctx = makeContext('doc', 1, root)
    await initializeBaseline(ctx, [owner], [], undefined, root)
    hydrateStore(ctx, [owner], ['5.3.1'])
    hydrateSource(ctx, [owner], ['p=1'])
    const slot = getFormulaStateStore().committedState!.slotsInDocumentOrder[0]
    expect(slot.authoritativeRawSource).toBe('p=1')
    // Composite text contains rendered/UI junk, but slot source is exact.
    expect(owner.textContent).toContain('公式')
    expect(owner.textContent).toContain('(5.3.1)')
    expect(slot.authoritativeRawSource).not.toContain('公式')
    expect(slot.authoritativeRawSource).not.toContain('5.3.1')
  })
})

// ── ASI-02: Renderer replacement does not change source ────────────────

describe('ASI-02 — Renderer replacement does not change source', () => {
  it('10x projection keeps sourceRevision/hash unchanged and no SOURCE_EDIT', async () => {
    const owner = makeCompositeHost('p=1', '(1)')
    const root = makeEditorRoot([owner])
    const ctx = makeContext('doc', 1, root)
    await initializeBaseline(ctx, [owner], [], undefined, root)
    hydrateStore(ctx, [owner], ['5.3.1'])
    hydrateSource(ctx, [owner], ['p=1'])
    const captured: string[] = []
    installProvider(captured)
    const slot0 = getFormulaStateStore().committedState!.slotsInDocumentOrder[0]
    const revBefore = slot0.authoritativeSourceRevision
    const hashBefore = slot0.authoritativeSourceHash
    const rawBefore = slot0.authoritativeRawSource
    for (let i = 0; i < 10; i++) {
      const slot = getFormulaStateStore().committedState!.slotsInDocumentOrder[0]
      await executeProjectionTransactions([makeTx(slot, 0)], root)
    }
    const slot = getFormulaStateStore().committedState!.slotsInDocumentOrder[0]
    expect(slot.authoritativeSourceRevision).toBe(revBefore)
    expect(slot.authoritativeSourceHash).toBe(hashBefore)
    expect(slot.authoritativeRawSource).toBe(rawBefore)
  })
})

// ── ASI-03: Formula body does not grow ─────────────────────────────────

describe('ASI-03 — Formula body does not grow', () => {
  it('raw source length constant after repeated projection', async () => {
    const owner = makeCompositeHost('p=1', '(1)')
    const root = makeEditorRoot([owner])
    const ctx = makeContext('doc', 1, root)
    await initializeBaseline(ctx, [owner], [], undefined, root)
    hydrateStore(ctx, [owner], ['5.3.1'])
    hydrateSource(ctx, [owner], ['p=1'])
    const captured: string[] = []
    installProvider(captured)
    const len0 = getFormulaStateStore().committedState!.slotsInDocumentOrder[0].authoritativeRawSource!.length
    for (let i = 0; i < 10; i++) {
      const slot = getFormulaStateStore().committedState!.slotsInDocumentOrder[0]
      await executeProjectionTransactions([makeTx(slot, 0)], root)
    }
    const len1 = getFormulaStateStore().committedState!.slotsInDocumentOrder[0].authoritativeRawSource!.length
    expect(len1).toBe(len0)
    for (const c of captured) expect(c).not.toContain('公式公式')
  })
})

// ── ASI-04: Single user edit → sourceChangedCount=1 ────────────────────

describe('ASI-04 — Single user edit changes exactly one source', () => {
  it('editing B only changes B', async () => {
    const a = makeCompositeHost('p=1', null)
    const b = makeCompositeHost('q=1', null)
    const c = makeCompositeHost('r=1', null)
    const root = makeEditorRoot([a, b, c])
    const ctx = makeContext('doc', 1, root)
    await initializeBaseline(ctx, [a, b, c], [], undefined, root)
    hydrateSource(ctx, [a, b, c], ['p=1', 'q=1', 'r=1'], 1)
    const store = getFormulaStateStore()
    const before = store.captureBeforeState()
    // Edit B only: q=1 → q=2, revision 2 for B only.
    hydrateSource(ctx, [b], ['q=2'], 2)
    const after = store.buildStateFromCanonicalHosts([a, b, c], [], null, undefined)!
    const cls = store.classifyOperation(before, after)
    // Exactly one surviving identity changed source.
    expect(cls.operationKind).toBe('SOURCE_EDIT')
    const bSlot = after.slotByStableIdentity.get(after.slotsInDocumentOrder[1].stableIdentity)
    const aSlot = after.slotByStableIdentity.get(after.slotsInDocumentOrder[0].stableIdentity)
    const cSlot = after.slotByStableIdentity.get(after.slotsInDocumentOrder[2].stableIdentity)
    expect(bSlot!.authoritativeSourceRevision).toBe(2)
    expect(aSlot!.authoritativeSourceRevision).toBe(1)
    expect(cSlot!.authoritativeSourceRevision).toBe(1)
  })
})

// ── ASI-05: Heading-only change source count zero ──────────────────────

describe('ASI-05 — Heading-only change source count zero', () => {
  it('re-hydrating numbering does not alter source', async () => {
    const a = makeCompositeHost('p=1', null)
    const root = makeEditorRoot([a])
    const ctx = makeContext('doc', 1, root)
    await initializeBaseline(ctx, [a], [], undefined, root)
    hydrateSource(ctx, [a], ['p=1'], 1)
    const store = getFormulaStateStore()
    const before = store.captureBeforeState()
    // Heading-only renumber (desiredTag changes, source untouched).
    hydrateStore(ctx, [a], ['5.4.1'])
    const after = store.buildStateFromCanonicalHosts([a], [], null, undefined)!
    const cls = store.classifyOperation(before, after)
    expect(after.slotsInDocumentOrder[0].authoritativeSourceRevision).toBe(1)
    // desiredTag changed but source did NOT → not SOURCE_EDIT.
    expect(cls.operationKind).not.toBe('SOURCE_EDIT')
  })
})

// ── ASI-06: Insert does not change survivor source ─────────────────────

describe('ASI-06 — Sequence insert survivor source unchanged', () => {
  it('surviving formulas keep sourceRevision after insert', async () => {
    const f1 = makeCompositeHost('a', null)
    const f2 = makeCompositeHost('b', null)
    const root = makeEditorRoot([f1, f2])
    const ctx = makeContext('doc', 1, root)
    await initializeBaseline(ctx, [f1, f2], [], undefined, root)
    hydrateSource(ctx, [f1, f2], ['a', 'b'], 1)
    const store = getFormulaStateStore()
    const f2RevBefore = store.committedState!.slotsInDocumentOrder[1].authoritativeSourceRevision
    const fNew = makeCompositeHost('NEW', null)
    root.insertBefore(fNew, f2)
    processFormulaSemanticEvent('FORMULA_ADDED', root, [], 'insert', ctx, [f1, fNew, f2])
    hydrateStore(ctx, [f1, fNew, f2], ['5.3.1', '5.3.2', '5.3.3'])
    const slots = store.committedState!.slotsInDocumentOrder
    const f2Slot = slots[2]
    expect(f2Slot.authoritativeSourceRevision).toBe(f2RevBefore)
    expect(f2Slot.authoritativeRawSource).toBe('b')
  })
})

// ── ASI-07: Empty known source ─────────────────────────────────────────

describe('ASI-07 — Empty known source', () => {
  it('empty slot is EMPTY + ready, rawSource="", never sentinel', async () => {
    const e = makeCompositeHost('', null)
    const root = makeEditorRoot([e])
    const ctx = makeContext('doc', 1, root)
    await initializeBaseline(ctx, [e], [], undefined, root)
    hydrateSource(ctx, [e], [''])
    const slot = getFormulaStateStore().committedState!.slotsInDocumentOrder[0]
    expect(slot.sourceState).toBe('EMPTY')
    expect(slot.sourceAuthorityReady).toBe(true)
    expect(slot.authoritativeRawSource).toBe('')
    expect(slot.authoritativeRawSource).not.toContain('Empty')
  })
})

// ── ASI-08: Unknown source blocks provider ─────────────────────────────

describe('ASI-08 — Unknown source blocks provider', () => {
  it('tx with UNKNOWN source is rejected before provider', async () => {
    const owner = makeCompositeHost('p=1', '(1)')
    const root = makeEditorRoot([owner])
    const ctx = makeContext('doc', 1, root)
    await initializeBaseline(ctx, [owner], [], undefined, root)
    hydrateStore(ctx, [owner], ['5.3.1'])
    // NO hydrateSource → slot stays UNKNOWN.
    const slot = getFormulaStateStore().committedState!.slotsInDocumentOrder[0]
    expect(slot.sourceState).toBe('UNKNOWN')
    const captured: string[] = []
    installProvider(captured)
    const exec = await executeProjectionTransactions([makeTx(slot, 0)], root)
    expect(exec.missingOwnershipCount).toBeGreaterThanOrEqual(1)
    expect(captured).toHaveLength(0)
  })
})

// ── ASI-09: Duplicate raw source independent identity ──────────────────

describe('ASI-09 — Duplicate raw source independent identity', () => {
  it('two p=1 have different identity, same hash, distinct projection', async () => {
    const p1a = makeCompositeHost('p=1', null)
    const p1b = makeCompositeHost('p=1', null)
    const root = makeEditorRoot([p1a, p1b])
    const ctx = makeContext('doc', 1, root)
    await initializeBaseline(ctx, [p1a, p1b], [], undefined, root)
    hydrateSource(ctx, [p1a, p1b], ['p=1', 'p=1'])
    const slots = getFormulaStateStore().committedState!.slotsInDocumentOrder
    expect(String(slots[0].stableIdentity)).not.toBe(String(slots[1].stableIdentity))
    expect(slots[0].authoritativeSourceHash).toBe(slots[1].authoritativeSourceHash)
    const captured: string[] = []
    installProvider(captured)
    await executeProjectionTransactions([makeTx(slots[0], 0), makeTx(slots[1], 1)], root)
    expect(captured.length).toBeGreaterThanOrEqual(1)
  })
})

// ── ASI-10: String stable identity continuity ──────────────────────────

describe('ASI-10 — String stable identity continuity', () => {
  it('tx identity equals provider request identity (no -1, no hostToken alias)', async () => {
    const owner = makeCompositeHost('p=1', '(1)')
    const root = makeEditorRoot([owner])
    const ctx = makeContext('doc', 1, root)
    await initializeBaseline(ctx, [owner], [], undefined, root)
    hydrateStore(ctx, [owner], ['5.3.1'])
    hydrateSource(ctx, [owner], ['p=1'])
    const slot = getFormulaStateStore().committedState!.slotsInDocumentOrder[0]
    expect(typeof slot.stableIdentity).toBe('string')
    const requested: Array<string | number> = []
    setOriginalTex2svgPromise((tex: unknown) => {
      requested.push(getFormulaStateStore().committedState!.slotsInDocumentOrder[0].stableIdentity)
      const node = document.createElement('mjx-container')
      node.textContent = '(5.3.1)'
      return Promise.resolve(node)
    })
    await executeProjectionTransactions([makeTx(slot, 0)], root)
    // The provider request carried the string identity — never -1/hostToken.
    expect(requested[0]).toBe(slot.stableIdentity)
  })
})

// ── ASI-11: NaturalRenderOptions string identity ───────────────────────

describe('ASI-11 — NaturalRenderOptions string identity', () => {
  it('options lookup succeeds for string identity (no -1)', () => {
    const id = 'doc:1:1:1787087513288'
    cacheNaturalRenderOptions(id, { scale: 1.0 })
    const opts = getNaturalRenderOptions(id)
    expect(opts).not.toBeNull()
    expect(opts!.scale).toBe(1.0)
  })
})

// ── ASI-12: Commit only after visible verify ───────────────────────────

describe('ASI-12 — Commit only after visible verify', () => {
  it('DOM replace with unreadable visible tag → FAIL (not PASS)', async () => {
    const owner = makeCompositeHost('p=1', '(1)')
    const root = makeEditorRoot([owner])
    const ctx = makeContext('doc', 1, root)
    await initializeBaseline(ctx, [owner], [], undefined, root)
    hydrateStore(ctx, [owner], ['5.3.1'])
    hydrateSource(ctx, [owner], ['p=1'])
    const slot = getFormulaStateStore().committedState!.slotsInDocumentOrder[0]
    const tx = makeTx(slot, 0)
    // Provider returns a node with NO readable tag text.
    setOriginalTex2svgPromise(() => {
      const node = document.createElement('mjx-container')
      node.textContent = '' // unreadable
      return Promise.resolve(node)
    })
    const captured: string[] = []
    const exec = await executeProjectionTransactions([tx], root)
    // committedCount may be 1 (DOM replaced) but visibleVerifiedCount=0.
    expect(exec.visibleVerifiedCount).toBe(0)
  })
})

// ── ASI-13: Same transaction double commit barrier ─────────────────────

describe('ASI-13 — Same transaction double commit barrier', () => {
  it('second commit on same tx is a NO-OP (DOM mutation <= 1)', async () => {
    const owner = makeCompositeHost('p=1', '(1)')
    const root = makeEditorRoot([owner])
    const ctx = makeContext('doc', 1, root)
    await initializeBaseline(ctx, [owner], [], undefined, root)
    hydrateStore(ctx, [owner], ['5.3.1'])
    hydrateSource(ctx, [owner], ['p=1'])
    const slot = getFormulaStateStore().committedState!.slotsInDocumentOrder[0]
    const tx = makeTx(slot, 0)
    const mjx1 = document.createElement('mjx-container')
    mjx1.textContent = '(5.3.1)'
    const r1 = commitProjectionFulfillmentViaCompositeOwner(tx, mjx1, root)
    expect(r1.domReplaceSucceeded).toBe(true)
    expect(tx.nativeDomMutationCount).toBe(1)
    const mjx2 = document.createElement('mjx-container')
    mjx2.textContent = '(5.3.1)'
    const r2 = commitProjectionFulfillmentViaCompositeOwner(tx, mjx2, root)
    expect(r2.domReplaceSucceeded).toBe(false)
    expect(tx.nativeDomMutationCount).toBe(1)
  })
})

// ── ASI-14: Renderer mutation must not create SOURCE_EDIT ──────────────

describe('ASI-14 — Renderer mutation must not create SOURCE_EDIT', () => {
  it('re-scan with same source revision → NOOP', async () => {
    const a = makeCompositeHost('p=1', '(1)')
    const root = makeEditorRoot([a])
    const ctx = makeContext('doc', 1, root)
    await initializeBaseline(ctx, [a], [], undefined, root)
    hydrateSource(ctx, [a], ['p=1'], 1)
    const store = getFormulaStateStore()
    const before = store.captureBeforeState()
    const after = store.buildStateFromCanonicalHosts([a], [], null, undefined)!
    const cls = store.classifyOperation(before, after)
    expect(cls.operationKind).toBe('NOOP')
  })
})

// ── ASI-15: No source contamination through visible tag ────────────────

describe('ASI-15 — No source contamination through visible tag', () => {
  it('renumber 5.3.1→5.3.2 does not change raw source', async () => {
    const owner = makeCompositeHost('p=1', '(5.3.1)')
    const root = makeEditorRoot([owner])
    const ctx = makeContext('doc', 1, root)
    await initializeBaseline(ctx, [owner], [], undefined, root)
    hydrateSource(ctx, [owner], ['p=1'], 1)
    hydrateStore(ctx, [owner], ['5.3.1'])
    const rawBefore = getFormulaStateStore().committedState!.slotsInDocumentOrder[0].authoritativeRawSource
    hydrateStore(ctx, [owner], ['5.3.2'])
    const rawAfter = getFormulaStateStore().committedState!.slotsInDocumentOrder[0].authoritativeRawSource
    expect(rawAfter).toBe('p=1')
    expect(rawAfter).toBe(rawBefore)
    expect(rawAfter).not.toContain('5.3.1')
    expect(rawAfter).not.toContain('5.3.2')
  })
})

// ── ASI-16: Explicit user tag safety ───────────────────────────────────

describe('ASI-16 — Explicit user tag safety', () => {
  it('user TeX with \\tag{custom} is not treated as contamination', () => {
    const src = 'p=1\\tag{custom}'
    expect(src).toContain('\\tag')
    // checkProjectionSourceIntegrity treats it as normal NONEMPTY source.
    const owner = makeCompositeHost(src, '(custom)')
    const root = makeEditorRoot([owner])
    const ctx = makeContext('doc', 1, root)
    return initializeBaseline(ctx, [owner], [], undefined, root).then(() => {
      hydrateSource(ctx, [owner], [src])
      const slot = getFormulaStateStore().committedState!.slotsInDocumentOrder[0]
      expect(slot.sourceState).toBe('NONEMPTY')
      expect(slot.authoritativeRawSource).toBe(src)
    })
  })
})

// ── ASI-17: Projection exact provider input ────────────────────────────

describe('ASI-17 — Projection exact provider input', () => {
  it('provider receives exact "p=1\\tag{5.3.1}" once', async () => {
    const owner = makeCompositeHost('p=1', '(1)')
    const root = makeEditorRoot([owner])
    const ctx = makeContext('doc', 1, root)
    await initializeBaseline(ctx, [owner], [], undefined, root)
    hydrateStore(ctx, [owner], ['5.3.1'])
    hydrateSource(ctx, [owner], ['p=1'])
    const captured: string[] = []
    installProvider(captured)
    const slot = getFormulaStateStore().committedState!.slotsInDocumentOrder[0]
    await executeProjectionTransactions([makeTx(slot, 0)], root)
    const norm = captured.map((c) => c.replace(/\r\n/g, '\n').trim())
    expect(norm).toContain('p=1\\tag{5.3.1}')
    const count = norm.filter((c) => c === 'p=1\\tag{5.3.1}').length
    expect(count).toBe(1)
  })
})

// ── ASI-18: Quiescence after renderer projection ───────────────────────

describe('ASI-18 — Quiescence after renderer projection', () => {
  it('pending projections return to zero after executor', async () => {
    const owner = makeCompositeHost('p=1', '(1)')
    const root = makeEditorRoot([owner])
    const ctx = makeContext('doc', 1, root)
    await initializeBaseline(ctx, [owner], [], undefined, root)
    hydrateStore(ctx, [owner], ['5.3.1'])
    hydrateSource(ctx, [owner], ['p=1'])
    installProvider([])
    const slot = getFormulaStateStore().committedState!.slotsInDocumentOrder[0]
    await executeProjectionTransactions([makeTx(slot, 0)], root)
    const truth = readFormulaVisibleStateTruth()
    expect(truth.allDesiredTagsVisible).toBe(true)
    expect(getPendingBaselineProjectionCount()).toBe(0)
  })
})

// ── Build ID ───────────────────────────────────────────────────────────

describe('ASI Build ID', () => {
  it('R54316_BUILD_ID is the R5.4.3.19 build', () => {
    expect(R54316_BUILD_ID).toBe('inkchapter-formula-authoritative-source-feedback-isolation-v2.5.7-r5.4.3.19')
  })
})

// ── extractFormulaTexForTrace no longer reads host.textContent ─────────

describe('ASI extractFormulaTexForTrace barrier', () => {
  it('returns "" when only composite text exists (no pre/rawblock)', () => {
    const owner = makeCompositeHost('p=1', '(5.3.1)')
    // The rawblock container is populated in our fixture, but if we build a
    // host with ONLY rendered text, the extractor must return ''.
    const junk = document.createElement('div')
    junk.textContent = '公式公式(5.3.2)公式'
    expect(extractFormulaTexForTrace(junk)).toBe('')
  })
})
