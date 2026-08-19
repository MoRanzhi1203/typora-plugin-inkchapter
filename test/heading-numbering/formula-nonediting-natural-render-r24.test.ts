// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  buildFormulaRenderAuthorizationPlan,
  handleTex2svgPreCall,
  nextPlanRevision,
  setTex2svgInjectionContext,
  type FormulaRenderAuthorizationPlan,
} from '../../src/heading-numbering/mathjax-tex2svg-tag-injection'
import {
  executeProjectionTransactions,
  hydrateNumberingAuthorityIntoFormulaStateStore,
  initializeBaseline,
  readVisibleBodyTruth,
  editorRootTokenFor,
} from '../../src/heading-numbering/formula-state-machine-wiring'
import { latchOrRebindCurrentFormulaTransaction, resetEditSessionState } from '../../src/heading-numbering/formula-edit-session'
import {
  getFormulaStateStore,
  resetFormulaStateStore,
  type FormulaRuntimeContext,
} from '../../src/heading-numbering/formula-state-store'
import { resetOperationClosureState } from '../../src/heading-numbering/formula-operation-closure'
import { setOriginalTex2svgPromise } from '../../src/heading-numbering/formula-render-projection'
import { simpleHash } from '../../src/heading-numbering/formula-tex-source-verifier'

function makeFormula(source: string, visibleTag: string | null = null): HTMLElement {
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
    mjx.textContent = `${source}(${visibleTag})`
    preview.appendChild(mjx)
    host.appendChild(preview)
  }
  return host
}

function makeSplitFormula(source: string, visibleTag: string): { owner: HTMLElement; raw: HTMLElement } {
  const owner = document.createElement('div')
  owner.className = 'md-math-block'
  const raw = document.createElement('div')
  raw.className = 'md-rawblock-container'
  raw.textContent = source
  const preview = document.createElement('div')
  preview.className = 'md-mathjax-preview'
  const mjx = document.createElement('mjx-container')
  mjx.textContent = `${source}(${visibleTag})`
  preview.appendChild(mjx)
  owner.appendChild(raw)
  owner.appendChild(preview)
  return { owner, raw }
}

function makeRoot(children: HTMLElement[]): HTMLElement {
  const root = document.createElement('div')
  root.className = 'md-editor-root'
  children.forEach((child) => root.appendChild(child))
  document.body.appendChild(root)
  return root
}

function cleanupRoots(): void {
  for (const el of Array.from(document.body.querySelectorAll('.md-editor-root'))) el.remove()
}

function context(root: HTMLElement): FormulaRuntimeContext {
  return {
    documentKey: 'doc-r24',
    documentGeneration: 1,
    editorRoot: root,
    editorRootToken: editorRootTokenFor(root),
  }
}

async function baseline(ctx: FormulaRuntimeContext, hosts: HTMLElement[], tags: string[]): Promise<void> {
  const overrides = new Map<HTMLElement, string | null>()
  hosts.forEach((host, index) => overrides.set(host, tags[index]))
  await initializeBaseline(ctx, hosts, [], overrides, ctx.editorRoot)
  hydrateNumberingAuthorityIntoFormulaStateStore({
    documentKey: ctx.documentKey,
    generation: ctx.documentGeneration,
    editorRoot: ctx.editorRoot,
    editorRootToken: ctx.editorRootToken,
    entries: hosts.map((host, index) => ({
      canonicalHost: host,
      chapterOrdinal: 11,
      sectionOrdinal: 2,
      subsectionOrdinal: null,
      sequenceValue: index + 1,
      scopeKey: 'ch-11.sec-2',
      desiredTag: tags[index],
      managedForNumbering: true,
    })),
    headingRevision: 1,
    numberingPlanRevision: 1,
  })
  const store = getFormulaStateStore()
  hosts.forEach((host) => {
    const raw = host.querySelector('.md-rawblock-container')?.textContent ?? host.textContent ?? ''
    store.hydrateFormulaSourceAuthority({
      documentKey: ctx.documentKey,
      generation: ctx.documentGeneration,
      editorRootToken: ctx.editorRootToken,
      canonicalHost: host,
      source: {
        sourceState: raw.trim() === '' ? 'EMPTY' : 'NONEMPTY',
        sourceAuthorityKind: raw.trim() === '' ? 'KNOWN_EMPTY' : 'AUTHORITATIVE_SOURCE',
        authoritativeRawSource: raw,
        authoritativeSourceHash: simpleHash(raw),
        authoritativeSourceRevision: 1,
      },
    })
  })
}

function planFor(host: HTMLElement, stableFormulaIdentity: number | null, source = 'RMSE'): FormulaRenderAuthorizationPlan {
  const plan = buildFormulaRenderAuthorizationPlan({
    managedFormulas: [{ host, formulaIndex: 0, desiredTag: '11.2.1' }],
    documentKey: 'doc-r24',
    documentPath: 'C:/vault/doc-r24.md',
    documentSourceRevision: 1,
    documentSourceSha256: 'sha-r24',
    generation: 1,
    editorRoot: host.closest('.md-editor-root') as HTMLElement | null,
    planRevision: nextPlanRevision(),
    authoritativeSourceByIndex: new Map([[0, {
      stableFormulaIdentity,
      formulaContentRevision: 1,
      hash: simpleHash(source),
      sourceKind: 'RAWBLOCK_SOURCE_CONTAINER',
      prefix: source,
      rawSourceLength: source.length,
      normalizedSourceLength: source.length,
    }]]),
  })
  plan.planLiveFormulaRevision = 1
  plan.planSemanticSignature = 'sem-r24'
  return plan
}

function installContext(root: HTMLElement, plan: FormulaRenderAuthorizationPlan, rebuild?: () => boolean): void {
  let contextToken = 1
  const bind = (withRebuild: boolean): void => setTex2svgInjectionContext({
    enabled: true,
    plan,
    getWorkspaceActivePath: () => 'C:/vault/doc-r24.md',
    getDocumentKey: () => 'doc-r24',
    getDocumentSourceSha256: () => 'sha-r24',
    getEditorRoot: () => root,
    getCurrentGeneration: () => 1,
    getCurrentLiveFormulaRevision: () => 1,
    getCurrentSemanticSignature: () => 'sem-r24',
    getContextToken: () => contextToken,
    rebuildPlanSynchronously: withRebuild && rebuild ? () => {
      const ok = rebuild()
      contextToken++
      bind(false)
      return ok
    } : undefined,
    resolveEditingHostIdentity: () => null,
  })
  bind(true)
}

beforeEach(() => {
  resetFormulaStateStore()
  resetOperationClosureState()
  resetEditSessionState()
  setTex2svgInjectionContext(null)
  setOriginalTex2svgPromise(null)
  cleanupRoots()
  vi.restoreAllMocks()
})

describe('R24 non-editing natural render authority and baseline visible closure', () => {
  it('T1/T2: known exit-edit owner survives source reauthorization mismatch', () => {
    const host = makeFormula('RMSE')
    const root = makeRoot([host])
    const plan = planFor(host, 1, 'RMSE')
    installContext(root, plan)
    latchOrRebindCurrentFormulaTransaction({
      documentKey: 'doc-r24',
      documentGeneration: 1,
      editorRootToken: editorRootTokenFor(root),
      formulaHost: host,
      stableFormulaIdentity: 1,
      formulaIndex: 0,
      planRevision: plan.planRevision,
      liveFormulaRevision: 1,
      desiredTag: '11.2.1',
      rawTex: 'RMSE',
      sourceState: 'NONEMPTY',
      createdBy: 'EDIT_SESSION',
    })

    const result = handleTex2svgPreCall(['\\operatorname{RMSE}'], null, 'r24-exit-edit')

    expect(result.decision).not.toBe('PASS_THROUGH')
    expect(result.injection?.desiredTag).toBe('11.2.1')
  })

  it('T2: same-call reauthorization validates but does not erase an existing managed owner', () => {
    const host = makeFormula('RMSE')
    const root = makeRoot([host])
    const plan = planFor(host, 1, 'RMSE')
    installContext(root, plan, () => true)
    latchOrRebindCurrentFormulaTransaction({
      documentKey: 'doc-r24',
      documentGeneration: 1,
      editorRootToken: editorRootTokenFor(root),
      formulaHost: host,
      stableFormulaIdentity: 1,
      formulaIndex: 0,
      planRevision: plan.planRevision,
      liveFormulaRevision: 1,
      desiredTag: '11.2.1',
      rawTex: 'RMSE',
      sourceState: 'NONEMPTY',
      createdBy: 'EDIT_SESSION',
    })

    const logs: string[] = []
    vi.spyOn(console, 'info').mockImplementation((line?: unknown) => {
      logs.push(String(line ?? ''))
    })

    const result = handleTex2svgPreCall(['\\operatorname{RMSE}'], null, 'r24-reauth')

    expect(result.decision).not.toBe('PASS_THROUGH')
    expect(logs.some((line) => line.includes('REAUTHORIZATION_STABLE_IDENTITY_MISSING'))).toBe(false)
  })

  it('T3/T5: non-editing natural render still injects the committed desiredTag', () => {
    const host = makeFormula('RMSE', '11.2.1')
    const root = makeRoot([host])
    const plan = planFor(host, 1, 'RMSE')
    installContext(root, plan)

    expect(host.classList.contains('md-focus')).toBe(false)
    expect(host.classList.contains('md-rawblock-on-edit')).toBe(false)
    const result = handleTex2svgPreCall(['\\operatorname{RMSE}'], null, 'r24-nonediting')

    expect(result.decision).not.toBe('PASS_THROUGH')
    expect(result.injection?.desiredTag).toBe('11.2.1')
  })

  it('T4: first-open baseline projection can commit from current Store slot without prior click', async () => {
    const host = makeFormula('RMSE')
    const root = makeRoot([host])
    const ctx = context(root)
    await baseline(ctx, [host], ['11.2.1'])
    setOriginalTex2svgPromise(async () => {
      const mjx = document.createElement('mjx-container')
      mjx.textContent = 'RMSE(11.2.1)'
      return mjx
    })

    const slot = getFormulaStateStore().lookupCommittedSlotByHost(host)!
    const txs = getFormulaStateStore().createProjectionTransactionsFromCommittedSlots({
      stableIdentities: [slot.stableIdentity],
      reason: 'r24-first-open-baseline',
      operationId: 'r24-first-open-baseline',
    })
    const exec = await executeProjectionTransactions(txs, root)

    expect(exec.requestedCount).toBe(1)
    expect(exec.committedCount).toBe(1)
    expect(exec.visibleVerifiedCount).toBe(1)
    expect(exec.missingOwnershipCount).toBe(0)
  })

  it('T6: visible verifier reads the adopted current DOM under the composite owner', async () => {
    const split = makeSplitFormula('RMSE', '11.2.1')
    const root = makeRoot([split.owner])
    const ctx = context(root)
    await baseline(ctx, [split.raw], ['11.2.1'])
    const slot = getFormulaStateStore().lookupCommittedSlotByHost(split.raw)!

    const truth = readVisibleBodyTruth(split.raw, slot)

    expect(truth.visibleTag).toBe('11.2.1')
    expect(truth.decision).toBe('PASS')
  })
})
