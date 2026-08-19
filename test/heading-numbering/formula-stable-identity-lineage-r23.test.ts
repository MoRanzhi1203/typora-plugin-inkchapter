// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  buildLiveFormulaSemanticSnapshot,
  computeAffectedFormulaSet,
  diffLiveFormulaPlans,
} from '../../src/heading-numbering/formula-live-revision'
import {
  executeProjectionTransactions,
  hydrateNumberingAuthorityIntoFormulaStateStore,
  initializeBaseline,
  processFormulaSemanticEvent,
  produceRenderTransaction,
  editorRootTokenFor,
} from '../../src/heading-numbering/formula-state-machine-wiring'
import {
  getFormulaStateStore,
  resetFormulaStateStore,
  type FormulaRuntimeContext,
} from '../../src/heading-numbering/formula-state-store'
import { resetOperationClosureState } from '../../src/heading-numbering/formula-operation-closure'
import { setOriginalTex2svgPromise } from '../../src/heading-numbering/formula-render-projection'
import { simpleHash } from '../../src/heading-numbering/formula-tex-source-verifier'

function makeHost(source: string, visibleTag: string | null = null): HTMLElement {
  const host = document.createElement('div')
  host.className = 'md-math-block'
  const raw = document.createElement('div')
  raw.className = 'md-rawblock-container'
  raw.textContent = source
  host.appendChild(raw)
  if (visibleTag !== null) {
    const preview = document.createElement('div')
    preview.className = 'md-mathjax-preview'
    const mjx = document.createElement('mjx-container')
    mjx.textContent = `(${visibleTag})`
    preview.appendChild(mjx)
    host.appendChild(preview)
  }
  return host
}

function makeRoot(hosts: HTMLElement[]): HTMLElement {
  const root = document.createElement('div')
  root.className = 'md-editor-root'
  for (const host of hosts) root.appendChild(host)
  document.body.appendChild(root)
  return root
}

function cleanupRoots(): void {
  for (const el of Array.from(document.body.querySelectorAll('.md-editor-root'))) el.remove()
}

function makeContext(root: HTMLElement): FormulaRuntimeContext {
  return {
    documentKey: 'doc-r23',
    documentGeneration: 1,
    editorRoot: root,
    editorRootToken: editorRootTokenFor(root),
  }
}

async function baseline(
  ctx: FormulaRuntimeContext,
  hosts: HTMLElement[],
  tags: string[],
): Promise<void> {
  const overrides = new Map<HTMLElement, string | null>()
  hosts.forEach((host, i) => overrides.set(host, tags[i]))
  await initializeBaseline(ctx, hosts, [], overrides, ctx.editorRoot)
  hydrateNumberingAuthorityIntoFormulaStateStore({
    documentKey: ctx.documentKey,
    generation: ctx.documentGeneration,
    editorRoot: ctx.editorRoot,
    editorRootToken: ctx.editorRootToken,
    entries: hosts.map((host, i) => ({
      canonicalHost: host,
      chapterOrdinal: 11,
      sectionOrdinal: 2,
      subsectionOrdinal: null,
      sequenceValue: i + 1,
      scopeKey: 'ch-11.sec-2',
      desiredTag: tags[i],
      managedForNumbering: true,
    })),
    headingRevision: 1,
    numberingPlanRevision: 1,
  })
  const store = getFormulaStateStore()
  hosts.forEach((host) => {
    const raw = host.querySelector('.md-rawblock-container')?.textContent ?? ''
    store.hydrateFormulaSourceAuthority({
      documentKey: ctx.documentKey,
      generation: ctx.documentGeneration,
      editorRootToken: ctx.editorRootToken,
      canonicalHost: host,
      source: {
        sourceState: raw === '' ? 'EMPTY' : 'NONEMPTY',
        sourceAuthorityKind: raw === '' ? 'KNOWN_EMPTY' : 'AUTHORITATIVE_SOURCE',
        authoritativeRawSource: raw,
        authoritativeSourceHash: simpleHash(raw),
        authoritativeSourceRevision: 1,
      },
    })
  })
}

function snapshot(hosts: HTMLElement[], tags: string[]) {
  const store = getFormulaStateStore()
  return buildLiveFormulaSemanticSnapshot({
    documentKey: 'doc-r23',
    liveFormulaRevision: 1,
    entries: hosts.map((host, index) => {
      const raw = host.querySelector('.md-rawblock-container')?.textContent ?? ''
      const slot = store.lookupCommittedSlotByHost(host)
      return {
        host,
        formulaIndex: index,
        documentOrder: index,
        desiredTag: tags[index],
        chapterOrdinal: 11,
        sectionOrdinal: 2,
        sequenceValue: index + 1,
        sourceKind: 'RAWBLOCK_SOURCE_CONTAINER' as const,
        normalizedSourceHash: simpleHash(raw),
        normalizedSourcePrefix: raw,
        managedEligible: true,
        formulaContentRevision: 1,
        scopeKey: 'ch-11.sec-2',
        canonicalStableIdentity: slot?.stableIdentity ?? null,
      }
    }),
  })
}

beforeEach(() => {
  resetFormulaStateStore()
  resetOperationClosureState()
  setOriginalTex2svgPromise(null)
  cleanupRoots()
  vi.restoreAllMocks()
})

describe('R23 causal stable identity lineage', () => {
  it('does not inherit renderer replacement identity from positional count parity alone', async () => {
    const p = makeHost('p=1', '11.2.1')
    const q = makeHost('q=2', '11.2.2')
    const root = makeRoot([p, q])
    const ctx = makeContext(root)
    await baseline(ctx, [p, q], ['11.2.1', '11.2.2'])
    const qIdentityBefore = getFormulaStateStore().lookupCommittedSlotByHost(q)!.stableIdentity
    const qReplacement = makeHost('q=2', '11.2.2')
    root.replaceChild(qReplacement, q)

    const logs: string[] = []
    vi.spyOn(console, 'info').mockImplementation((line?: unknown) => {
      logs.push(String(line ?? ''))
    })

    const result = processFormulaSemanticEvent(
      'FORMULA_SOURCE_CHANGED',
      root,
      [],
      'r23-bare-renderer-replacement',
      ctx,
      [p, qReplacement],
    )

    expect(result.transaction?.operationKind).not.toBe('STRUCTURAL_HOST_REBIND')
    expect(getFormulaStateStore().lookupCommittedSlotByHost(qReplacement)).toBeNull()
    expect(getFormulaStateStore().committedState!.slotByStableIdentity.get(qIdentityBefore)!.canonicalHost).toBe(q)
    expect(logs.some((line) => line.includes('POSITIONAL_COUNT_PARITY'))).toBe(false)
  })

  it('inherits renderer replacement identity only through an explicit causal rebind ticket', async () => {
    const p = makeHost('p=1', '11.2.1')
    const q = makeHost('q=2', '11.2.2')
    const root = makeRoot([p, q])
    const ctx = makeContext(root)
    await baseline(ctx, [p, q], ['11.2.1', '11.2.2'])
    const store = getFormulaStateStore()
    const qIdentityBefore = store.lookupCommittedSlotByHost(q)!.stableIdentity
    const renderTx = produceRenderTransaction(q)!
    const qReplacement = makeHost('q=2', '11.2.2')
    root.replaceChild(qReplacement, q)

    expect(typeof (store as any).registerRendererCausalRebindTicket).toBe('function')
    ;(store as any).registerRendererCausalRebindTicket({
      stableIdentity: qIdentityBefore,
      oldCanonicalHost: q,
      newCanonicalHost: qReplacement,
      renderTransactionId: renderTx.renderTransactionId,
      reason: 'RENDER_TRANSACTION_MUTATION_LINEAGE',
    })

    const result = processFormulaSemanticEvent(
      'FORMULA_SOURCE_CHANGED',
      root,
      [],
      'r23-causal-renderer-replacement',
      ctx,
      [p, qReplacement],
    )

    expect(result.transaction?.operationKind).toBe('STRUCTURAL_HOST_REBIND')
    const qAfter = store.lookupCommittedSlotByHost(qReplacement)!
    expect(qAfter.stableIdentity).toBe(qIdentityBefore)
    expect(qAfter.authoritativeRawSource).toBe('q=2')
    expect(qAfter.desiredTag).toBe('11.2.2')
  })

  it('uses committed Store stable identities for affected survivors after a middle insert', async () => {
    const p = makeHost('p=1', '11.2.1')
    const q = makeHost('q=2', '11.2.2')
    const rmse = makeHost('RMSE', '11.2.3')
    const root = makeRoot([p, q, rmse])
    const ctx = makeContext(root)
    await baseline(ctx, [p, q, rmse], ['11.2.1', '11.2.2', '11.2.3'])
    const qIdentityBefore = getFormulaStateStore().lookupCommittedSlotByHost(q)!.stableIdentity
    const rmseIdentityBefore = getFormulaStateStore().lookupCommittedSlotByHost(rmse)!.stableIdentity
    const before = snapshot([p, q, rmse], ['11.2.1', '11.2.2', '11.2.3'])

    const c = makeHost('c=a+b', '11.2.2')
    root.insertBefore(c, q)
    const overrides = new Map<HTMLElement, string | null>([
      [p, '11.2.1'],
      [c, '11.2.2'],
      [q, '11.2.3'],
      [rmse, '11.2.4'],
    ])
    processFormulaSemanticEvent('FORMULA_ADDED', root, [], 'r23-middle-insert', ctx, [p, c, q, rmse], overrides)
    const after = snapshot([p, c, q, rmse], ['11.2.1', '11.2.2', '11.2.3', '11.2.4'])

    const affected = computeAffectedFormulaSet(diffLiveFormulaPlans(before, after))
    const storeState = getFormulaStateStore().committedState!
    const unresolved = affected.affectedStableFormulaIdentities.filter((id) => {
      return typeof id !== 'string' || !storeState.slotByStableIdentity.has(id)
    })

    expect(unresolved).toEqual([])
    expect(affected.affectedStableFormulaIdentities).toContain(qIdentityBefore)
    expect(affected.affectedStableFormulaIdentities).toContain(rmseIdentityBefore)
  })

  it('creates existing-survivor projection requests directly from current committed slots', async () => {
    const p = makeHost('p=1', '11.2.1')
    const q = makeHost('q=2', '11.2.2')
    const rmse = makeHost('RMSE', '11.2.3')
    const root = makeRoot([p, q, rmse])
    const ctx = makeContext(root)
    await baseline(ctx, [p, q, rmse], ['11.2.1', '11.2.2', '11.2.3'])
    const qIdentityBefore = getFormulaStateStore().lookupCommittedSlotByHost(q)!.stableIdentity
    const rmseIdentityBefore = getFormulaStateStore().lookupCommittedSlotByHost(rmse)!.stableIdentity

    const c = makeHost('c=a+b', '11.2.2')
    root.insertBefore(c, q)
    const overrides = new Map<HTMLElement, string | null>([
      [p, '11.2.1'],
      [c, '11.2.2'],
      [q, '11.2.3'],
      [rmse, '11.2.4'],
    ])
    processFormulaSemanticEvent('FORMULA_ADDED', root, [], 'r23-direct-projection', ctx, [p, c, q, rmse], overrides)
    const store = getFormulaStateStore()

    expect(typeof (store as any).createProjectionTransactionsFromCommittedSlots).toBe('function')
    const txs = (store as any).createProjectionTransactionsFromCommittedSlots({
      stableIdentities: [qIdentityBefore, rmseIdentityBefore],
      reason: 'AFFECTED_SURVIVOR_CURRENT_SLOT_PROJECTION',
    })

    expect(txs).toHaveLength(2)
    expect(txs.map((tx: any) => tx.operationId)).not.toContain('NOOP')
    expect(txs.map((tx: any) => tx.desiredTag)).toEqual(['11.2.3', '11.2.4'])
    expect(txs.map((tx: any) => tx.stableIdentity)).toEqual([qIdentityBefore, rmseIdentityBefore])
  })

  it('projects 11.2 middle-insert suffix cascade without changing q/RMSE identities', async () => {
    const p = makeHost('p=1', '11.2.1')
    const q = makeHost('q=2', '11.2.2')
    const rmse = makeHost('RMSE', '11.2.3')
    const root = makeRoot([p, q, rmse])
    const ctx = makeContext(root)
    await baseline(ctx, [p, q, rmse], ['11.2.1', '11.2.2', '11.2.3'])
    const qIdentityBefore = getFormulaStateStore().lookupCommittedSlotByHost(q)!.stableIdentity
    const rmseIdentityBefore = getFormulaStateStore().lookupCommittedSlotByHost(rmse)!.stableIdentity

    const c = makeHost('c=a+b', '11.2.2')
    root.insertBefore(c, q)
    const overrides = new Map<HTMLElement, string | null>([
      [p, '11.2.1'],
      [c, '11.2.2'],
      [q, '11.2.3'],
      [rmse, '11.2.4'],
    ])
    const result = processFormulaSemanticEvent('FORMULA_ADDED', root, [], 'r23-suffix-cascade', ctx, [p, c, q, rmse], overrides)
    const store = getFormulaStateStore()
    store.hydrateFormulaSourceAuthority({
      documentKey: ctx.documentKey,
      generation: ctx.documentGeneration,
      editorRootToken: ctx.editorRootToken,
      canonicalHost: c,
      source: {
        sourceState: 'NONEMPTY',
        sourceAuthorityKind: 'AUTHORITATIVE_SOURCE',
        authoritativeRawSource: 'c=a+b',
        authoritativeSourceHash: simpleHash('c=a+b'),
        authoritativeSourceRevision: 1,
      },
    })

    expect(store.lookupCommittedSlotByHost(q)!.stableIdentity).toBe(qIdentityBefore)
    expect(store.lookupCommittedSlotByHost(rmse)!.stableIdentity).toBe(rmseIdentityBefore)
    expect(store.committedState!.slotsInDocumentOrder.map((slot) => slot.desiredTag)).toEqual([
      '11.2.1',
      '11.2.2',
      '11.2.3',
      '11.2.4',
    ])

    setOriginalTex2svgPromise((tex: unknown) => {
      const node = document.createElement('mjx-container')
      const math = document.createElement('mjx-math')
      math.textContent = String(tex).replace(/\\tag\{[^}]*\}/, '').trim()
      node.appendChild(math)
      const label = document.createElement('mjx-label')
      const match = String(tex).match(/\\tag\{([^}]*)\}/)
      label.textContent = match ? `(${match[1]})` : ''
      node.appendChild(label)
      return Promise.resolve(node)
    })

    const direct = (store as any).createProjectionTransactionsFromCommittedSlots
    const txs = typeof direct === 'function'
      ? direct.call(store, {
          stableIdentities: store.committedState!.slotsInDocumentOrder.map((slot) => slot.stableIdentity),
          reason: 'R23_SUFFIX_CASCADE_CURRENT_SLOT_PROJECTION',
        })
      : result.projectionTransactions
    const exec = await executeProjectionTransactions(txs, root)

    expect(exec.failedCount).toBe(0)
    expect(exec.visibleVerifiedCount).toBe(4)
  })
})
