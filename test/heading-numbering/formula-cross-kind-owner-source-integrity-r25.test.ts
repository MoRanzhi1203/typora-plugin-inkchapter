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
  editorRootTokenFor,
  hydrateNumberingAuthorityIntoFormulaStateStore,
  initializeBaseline,
  productionCallCounters,
} from '../../src/heading-numbering/formula-state-machine-wiring'
import { resetEditSessionState } from '../../src/heading-numbering/formula-edit-session'
import {
  getFormulaStateStore,
  resetFormulaStateStore,
  type FormulaRuntimeContext,
} from '../../src/heading-numbering/formula-state-store'
import { resetOperationClosureState } from '../../src/heading-numbering/formula-operation-closure'
import { setOriginalTex2svgPromise } from '../../src/heading-numbering/formula-render-projection'
import { simpleHash } from '../../src/heading-numbering/formula-tex-source-verifier'

const RMSE_SOURCE = '\\mathrm{RMSE}=\\sqrt{\\frac{1}{n}\\sum_{i=1}^{n}(y_i-\\hat{y}_i)^2}'
const INLINE_R2_SOURCE = 'R^2'

function makeBlockFormula(source: string, editing = false): HTMLElement {
  const host = document.createElement('div')
  host.className = editing
    ? 'mathjax-block md-math-block md-rawblock md-rawblock-on-edit md-focus'
    : 'mathjax-block md-math-block md-rawblock'
  const raw = document.createElement('div')
  raw.className = 'md-rawblock-container'
  raw.textContent = source
  host.appendChild(raw)
  const preview = document.createElement('div')
  preview.className = 'md-mathjax-preview'
  const mjx = document.createElement('mjx-container')
  mjx.textContent = `${source}(11.2.1)`
  preview.appendChild(mjx)
  host.appendChild(preview)
  return host
}

function makeInlineParagraph(): HTMLElement {
  const p = document.createElement('p')
  p.textContent = 'The document uses MAE, RMSE and '
  const inlineMath = document.createElement('span')
  inlineMath.className = 'md-inline-math'
  inlineMath.textContent = `$${INLINE_R2_SOURCE}$`
  p.appendChild(inlineMath)
  p.appendChild(document.createTextNode(' to evaluate model performance.'))
  return p
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
    documentKey: 'doc-r25',
    documentGeneration: 1,
    editorRoot: root,
    editorRootToken: editorRootTokenFor(root),
  }
}

async function baseline(ctx: FormulaRuntimeContext, host: HTMLElement): Promise<void> {
  await initializeBaseline(ctx, [host], [], new Map([[host, '11.2.1']]), ctx.editorRoot)
  hydrateNumberingAuthorityIntoFormulaStateStore({
    documentKey: ctx.documentKey,
    generation: ctx.documentGeneration,
    editorRoot: ctx.editorRoot,
    editorRootToken: ctx.editorRootToken,
    entries: [{
      canonicalHost: host,
      chapterOrdinal: 11,
      sectionOrdinal: 2,
      subsectionOrdinal: null,
      sequenceValue: 1,
      scopeKey: 'ch-11.sec-2',
      desiredTag: '11.2.1',
      managedForNumbering: true,
    }],
    headingRevision: 1,
    numberingPlanRevision: 1,
  })
  getFormulaStateStore().hydrateFormulaSourceAuthority({
    documentKey: ctx.documentKey,
    generation: ctx.documentGeneration,
    editorRootToken: ctx.editorRootToken,
    canonicalHost: host,
    source: {
      sourceState: 'NONEMPTY',
      sourceAuthorityKind: 'AUTHORITATIVE_SOURCE',
      authoritativeRawSource: RMSE_SOURCE,
      authoritativeSourceHash: simpleHash(RMSE_SOURCE),
      authoritativeSourceRevision: 1,
    },
  })
}

function planFor(host: HTMLElement, stableFormulaIdentity: string | number): FormulaRenderAuthorizationPlan {
  const plan = buildFormulaRenderAuthorizationPlan({
    managedFormulas: [{ host, formulaIndex: 0, desiredTag: '11.2.1' }],
    documentKey: 'doc-r25',
    documentPath: 'C:/vault/doc-r25.md',
    documentSourceRevision: 1,
    documentSourceSha256: 'sha-r25',
    generation: 1,
    editorRoot: host.closest('.md-editor-root') as HTMLElement | null,
    planRevision: nextPlanRevision(),
    authoritativeSourceByIndex: new Map([[0, {
      stableFormulaIdentity: typeof stableFormulaIdentity === 'number' ? stableFormulaIdentity : 1,
      formulaContentRevision: 1,
      hash: simpleHash(RMSE_SOURCE),
      sourceKind: 'RAWBLOCK_SOURCE_CONTAINER',
      prefix: RMSE_SOURCE,
      rawSourceLength: RMSE_SOURCE.length,
      normalizedSourceLength: RMSE_SOURCE.length,
    }]]),
  })
  plan.entries[0].stableFormulaIdentity = stableFormulaIdentity as number
  plan.planLiveFormulaRevision = 1
  plan.planSemanticSignature = 'sem-r25'
  return plan
}

function installContext(root: HTMLElement, plan: FormulaRenderAuthorizationPlan, host: HTMLElement): void {
  let contextToken = 1
  const bind = (withRebuild: boolean): void => setTex2svgInjectionContext({
    enabled: true,
    plan,
    getWorkspaceActivePath: () => 'C:/vault/doc-r25.md',
    getDocumentKey: () => 'doc-r25',
    getDocumentSourceSha256: () => 'sha-r25',
    getEditorRoot: () => root,
    getCurrentGeneration: () => 1,
    getCurrentLiveFormulaRevision: () => 1,
    getCurrentSemanticSignature: () => 'sem-r25',
    getContextToken: () => contextToken,
    rebuildPlanSynchronously: withRebuild ? () => {
      contextToken++
      bind(false)
      return true
    } : undefined,
    resolveEditingHostIdentity: () => ({
      candidateCount: 1,
      stableFormulaIdentity: getFormulaStateStore().lookupCommittedSlotByHost(host)?.stableIdentity ?? null,
      formulaIndex: 0,
      planEntryFound: true,
      decision: 'PASS',
    }),
  })
  bind(true)
}

function resetCounters(): void {
  for (const key of Object.keys(productionCallCounters)) {
    ;(productionCallCounters as Record<string, number>)[key] = 0
  }
}

async function setupEditingRmse(): Promise<{ host: HTMLElement; root: HTMLElement; ctx: FormulaRuntimeContext; stableIdentity: string | number }> {
  const host = makeBlockFormula(RMSE_SOURCE, true)
  const inline = makeInlineParagraph()
  const root = makeRoot([host, inline])
  const ctx = context(root)
  await baseline(ctx, host)
  const stableIdentity = getFormulaStateStore().lookupCommittedSlotByHost(host)!.stableIdentity
  const plan = planFor(host, stableIdentity)
  installContext(root, plan, host)
  return { host, root, ctx, stableIdentity }
}

beforeEach(() => {
  resetFormulaStateStore()
  resetOperationClosureState()
  resetEditSessionState()
  setTex2svgInjectionContext(null)
  setOriginalTex2svgPromise(null)
  cleanupRoots()
  resetCounters()
  vi.restoreAllMocks()
})

describe('R25 cross-kind render owner isolation and source authority integrity', () => {
  it('T1/T2: inline R^2 cannot inherit active RMSE block owner or inject a managed tag', async () => {
    await setupEditingRmse()

    const result = handleTex2svgPreCall([INLINE_R2_SOURCE, { display: false }], null, 'inline-r2')

    expect(result.decision).toBe('PASS_THROUGH')
    expect(result.injection).toBeNull()
    expect(result.applyArgs[0]).toBe(INLINE_R2_SOURCE)
  })

  it('T3/T4/T7: inline R^2 has zero business source side effects on RMSE', async () => {
    const { host } = await setupEditingRmse()
    const before = getFormulaStateStore().lookupCommittedSlotByHost(host)!

    handleTex2svgPreCall([INLINE_R2_SOURCE, { display: false }], null, 'inline-r2')
    const after = getFormulaStateStore().lookupCommittedSlotByHost(host)!

    expect(after.authoritativeRawSource).toBe(before.authoritativeRawSource)
    expect(after.authoritativeSourceHash).toBe(before.authoritativeSourceHash)
    expect(after.authoritativeSourceRevision).toBe(before.authoritativeSourceRevision)
    expect(after.desiredTag).toBe('11.2.1')
    expect(productionCallCounters.transitionalSourcePromotionCount).toBe(0)
    expect(productionCallCounters.userSourceEditCount).toBe(0)
  })

  it('T5: real RMSE remains authorized after unrelated inline R^2 render', async () => {
    await setupEditingRmse()

    handleTex2svgPreCall([INLINE_R2_SOURCE, { display: false }], null, 'inline-r2')
    const result = handleTex2svgPreCall([RMSE_SOURCE], null, 'rmse-natural')

    expect(result.decision).not.toBe('PASS_THROUGH')
    expect(result.injection?.desiredTag).toBe('11.2.1')
  })

  it('T6: actual RMSE user edit can still advance source authority', async () => {
    const { host, ctx } = await setupEditingRmse()
    const edited = `${RMSE_SOURCE}+1`
    const before = getFormulaStateStore().lookupCommittedSlotByHost(host)!

    const result = getFormulaStateStore().promoteTransitionalCurrentEditSource(host, edited, ctx)
    const after = getFormulaStateStore().lookupCommittedSlotByHost(host)!

    expect(result.ok).toBe(true)
    expect(after.authoritativeRawSource).toBe(edited)
    expect(after.authoritativeSourceRevision).toBe((before.authoritativeSourceRevision ?? 0) + 1)
  })

  it('T8: source-not-ready baseline stays waiting instead of fabricating an executable projection', async () => {
    const host = makeBlockFormula(RMSE_SOURCE, false)
    const root = makeRoot([host])
    const ctx = context(root)
    await initializeBaseline(ctx, [host], [], new Map([[host, '11.2.1']]), ctx.editorRoot)
    hydrateNumberingAuthorityIntoFormulaStateStore({
      documentKey: ctx.documentKey,
      generation: ctx.documentGeneration,
      editorRoot: ctx.editorRoot,
      editorRootToken: ctx.editorRootToken,
      entries: [{
        canonicalHost: host,
        chapterOrdinal: 11,
        sectionOrdinal: 2,
        subsectionOrdinal: null,
        sequenceValue: 1,
        scopeKey: 'ch-11.sec-2',
        desiredTag: '11.2.1',
        managedForNumbering: true,
      }],
      headingRevision: 1,
      numberingPlanRevision: 1,
    })
    const slot = getFormulaStateStore().lookupCommittedSlotByHost(host)!

    const txs = getFormulaStateStore().createProjectionTransactionsFromCommittedSlots({
      stableIdentities: [slot.stableIdentity],
      reason: 'r25-source-not-ready',
      operationId: 'r25-source-not-ready',
    })

    expect(slot.sourceAuthorityReady).toBe(false)
    expect(txs).toHaveLength(0)
  })

  it('T9: raw block bootstrap reads only the exact formula source container', async () => {
    const host = makeBlockFormula(RMSE_SOURCE, false)
    const inline = makeInlineParagraph()
    const root = makeRoot([host, inline])
    const ctx = context(root)
    await baseline(ctx, host)

    const slot = getFormulaStateStore().lookupCommittedSlotByHost(host)!

    expect(slot.authoritativeRawSource).toBe(RMSE_SOURCE)
    expect(slot.authoritativeRawSource).not.toContain(INLINE_R2_SOURCE)
    expect(slot.authoritativeSourceHash).toBe(simpleHash(RMSE_SOURCE))
  })
})
