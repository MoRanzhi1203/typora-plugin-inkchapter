// @vitest-environment jsdom
/**
 * v2.5.7-R5.4.2 Unit Tests: Authoritative Formula Source + Content Revision +
 * Drift Barrier + Editing-Host Identity + Post-Catchup Rebind + Accounting.
 *
 * Covers Phase S items 1-26.
 */
import { describe, it, expect, beforeEach } from 'vitest'
import {
  captureOrUpdateAuthoritativeSource,
  getAuthoritativeSourceState,
  resolveCurrentEditingFormulaIdentity,
  resetAuthoritativeSourceStates,
  classifyFormulaSourceCandidate,
} from './formula-authoritative-source'
import {
  buildLiveFormulaSemanticSnapshot,
  advanceLiveRevision,
  recordSemanticBaseline,
  resolveStableFormulaIdentity,
  resetLiveRevisionState,
  resetIdentityTokens,
  type LiveFormulaSemanticEntryInput,
  type LiveFormulaSemanticSnapshot,
} from './formula-live-revision'
import {
  buildFormulaRenderAuthorizationPlan,
  resolvePreCallAuthorization,
  handleTex2svgPreCall,
  setTex2svgInjectionContext,
  nextPlanRevision,
  resetFrozenPlanSources,
  resetPreCallCatchupState,
  reportInjectionFulfillment,
  getCatchupStats,
  getCallsiteAuthorityDecision,
  type FormulaRenderAuthorizationPlan,
  type Tex2svgInjectionRuntimeContext,
} from './mathjax-tex2svg-tag-injection'
import {
  computeLiveUpdateAccounting,
  setLiveUpdateTerminalState,
  resetInvalidationDedupeState,
  resetLiveUpdateTerminalStates,
} from './typora-formula-render-invalidation'
import { simpleHash, normalizeTexSource } from './formula-tex-source-verifier'
import {
  latchEditSession,
  markSessionExplicitInput,
  resetEditSessionState,
} from './formula-edit-session'

const DOC = 'docA'

function hostWithSource(tex: string): HTMLElement {
  const host = document.createElement('div')
  host.className = 'mathjax-block md-end-block md-math-block md-rawblock'
  host.textContent = `$$${tex}$$`
  return host
}

function capture(host: HTMLElement, opts: {
  tex?: string
  classification?: 'REAL_DOCUMENT_CONTENT' | 'TYPOORA_RENDERER_INTERNAL_ONLY' | 'MIXED_CONTENT_AND_RENDERER'
  editState?: 'EDIT' | 'NON_EDIT' | 'UNKNOWN'
  kind?: 'FORMULA_HOST_RAW_SOURCE_NODE' | 'RAWBLOCK_SOURCE_CONTAINER' | 'SAFE_HOST_TEXT_SOURCE_SEGMENT'
  revision?: number
}) {
  const tex = normalizeTexSource(opts.tex ?? host.textContent ?? '')
  const kind = opts.kind ?? 'RAWBLOCK_SOURCE_CONTAINER'
  return captureOrUpdateAuthoritativeSource({
    documentKey: DOC,
    stableFormulaIdentity: resolveStableFormulaIdentity(host),
    formulaIndex: 0,
    liveFormulaRevision: opts.revision ?? 0,
    candidateSourceKind: kind,
    candidateRawSource: tex,
    candidateNormalized: tex,
    candidateHash: simpleHash(tex),
    candidatePrefix: tex.slice(0, 40),
    mutationClassification: opts.classification ?? 'REAL_DOCUMENT_CONTENT',
    editState: opts.editState ?? 'NON_EDIT',
  })
}

function buildAuthoritativePlan(input: {
  entries: Array<{ host: HTMLElement; index: number; tag: string; identity: number; contentRevision?: number; hash?: string }>
  revision?: number
}): FormulaRenderAuthorizationPlan {
  const byIndex = new Map<number, { stableFormulaIdentity: number | null; formulaContentRevision: number; hash: string; sourceKind: 'FORMULA_HOST_RAW_SOURCE_NODE' | 'RAWBLOCK_SOURCE_CONTAINER' | 'SAFE_HOST_TEXT_SOURCE_SEGMENT'; prefix: string; rawSourceLength: number; normalizedSourceLength: number }>()
  for (const e of input.entries) {
    byIndex.set(e.index, {
      stableFormulaIdentity: e.identity,
      formulaContentRevision: e.contentRevision ?? 1,
      hash: e.hash ?? '',
      sourceKind: 'RAWBLOCK_SOURCE_CONTAINER',
      prefix: '',
      rawSourceLength: 1,
      normalizedSourceLength: 1,
    })
  }
  return buildFormulaRenderAuthorizationPlan({
    managedFormulas: input.entries.map((e) => ({ host: e.host, formulaIndex: e.index, desiredTag: e.tag })),
    documentKey: DOC,
    documentPath: 'p',
    documentSourceRevision: 2,
    documentSourceSha256: 'SHA-X',
    planRevision: nextPlanRevision(),
    generation: 2,
    editorRoot: null,
    planLiveFormulaRevision: input.revision ?? 1,
    planSemanticSignature: 'S1',
    authoritativeSourceByIndex: byIndex,
  })
}

function snapshot(entries: LiveFormulaSemanticEntryInput[]): LiveFormulaSemanticSnapshot {
  return buildLiveFormulaSemanticSnapshot({ documentKey: DOC, liveFormulaRevision: 0, entries })
}

function baseAuth(plan: FormulaRenderAuthorizationPlan | null, tex: string, overrides: Record<string, unknown> = {}): ReturnType<typeof resolvePreCallAuthorization> {
  return resolvePreCallAuthorization({
    plan,
    inputTex: tex,
    sameDocument: true,
    sameSourceRevision: true,
    formulaNumberingEnabled: true,
    editingHostSourceHashes: [],
    ...overrides,
  })
}

describe('Authoritative Formula Source (v2.5.7-R5.4.2)', () => {
  beforeEach(() => {
    resetAuthoritativeSourceStates()
    resetLiveRevisionState()
    resetIdentityTokens()
    resetFrozenPlanSources()
    resetPreCallCatchupState()
    resetInvalidationDedupeState()
    resetLiveUpdateTerminalStates()
    setTex2svgInjectionContext(null)
  })

  it('1. renderer candidate hash change 鈫?authoritative source unchanged', () => {
    const host = hostWithSource('x+y')
    capture(host, { classification: 'REAL_DOCUMENT_CONTENT', editState: 'NON_EDIT' })
    const before = getAuthoritativeSourceState(DOC, resolveStableFormulaIdentity(host))
    capture(host, { classification: 'TYPOORA_RENDERER_INTERNAL_ONLY', editState: 'NON_EDIT', tex: 'rendered visual text' })
    const after = getAuthoritativeSourceState(DOC, resolveStableFormulaIdentity(host))
    expect(after?.normalizedSourceHash).toBe(before?.normalizedSourceHash)
    expect(after?.formulaContentRevision).toBe(before?.formulaContentRevision)
  })

  it('2. sourceKind RAWBLOCK 鈫?HOST, same user TeX 鈫?contentRevision unchanged', () => {
    const host = hostWithSource('x+y')
    capture(host, { classification: 'REAL_DOCUMENT_CONTENT', editState: 'NON_EDIT', kind: 'RAWBLOCK_SOURCE_CONTAINER' })
    capture(host, { classification: 'TYPOORA_RENDERER_INTERNAL_ONLY', editState: 'NON_EDIT', kind: 'FORMULA_HOST_RAW_SOURCE_NODE' })
    const state = getAuthoritativeSourceState(DOC, resolveStableFormulaIdentity(host))
    expect(state?.formulaContentRevision).toBe(1)
  })

  it('3. rendered "(1)..." text 鈫?RENDERED_TEXT 鈫?cannot overwrite', () => {
    const host = hostWithSource('x+y')
    capture(host, { classification: 'REAL_DOCUMENT_CONTENT', editState: 'NON_EDIT' })
    const cls = classifyFormulaSourceCandidate({ candidateSourceKind: 'SAFE_HOST_TEXT_SOURCE_SEGMENT', candidateRawSource: '(1)y^t+1=...', candidateHash: 'zzz' })
    expect(cls.classification).toBe('RENDERED_TEXT')
    const result = capture(host, { classification: 'TYPOORA_RENDERER_INTERNAL_ONLY', editState: 'NON_EDIT', tex: '(1)y^t+1=...' })
    expect(result.overwriteBlocked).toBe(true)
    expect(getAuthoritativeSourceState(DOC, resolveStableFormulaIdentity(host))?.normalizedSourceHash).toBe(simpleHash('x+y'))
  })

  it('4. USER_FORMULA_SOURCE_CHANGE 鈫?contentRevision +1 + source update', () => {
    const host = hostWithSource('x+y')
    capture(host, { classification: 'REAL_DOCUMENT_CONTENT', editState: 'NON_EDIT' })
    const result = capture(host, { classification: 'REAL_DOCUMENT_CONTENT', editState: 'EDIT', tex: 'x+y+z' })
    expect(result.userSemanticSourceChange).toBe(true)
    expect(result.contentRevisionChanged).toBe(true)
    expect(result.authoritativeSourceUpdated).toBe(true)
    const state = getAuthoritativeSourceState(DOC, resolveStableFormulaIdentity(host))
    expect(state?.formulaContentRevision).toBe(2)
    expect(state?.normalizedSourceHash).toBe(simpleHash('x+y+z'))
  })

  it('5. desiredTag change only 鈫?contentRevision unchanged', () => {
    const host = hostWithSource('x+y')
    capture(host, { classification: 'REAL_DOCUMENT_CONTENT', editState: 'NON_EDIT' })
    // Re-capture same source (tag change is outside the source module).
    const result = capture(host, { classification: 'REAL_DOCUMENT_CONTENT', editState: 'NON_EDIT' })
    expect(result.contentRevisionChanged).toBe(false)
    expect(getAuthoritativeSourceState(DOC, resolveStableFormulaIdentity(host))?.formulaContentRevision).toBe(1)
  })

  it('6. other formula added 鈫?this formula contentRevision unchanged', () => {
    const hostA = hostWithSource('x+y')
    capture(hostA, { classification: 'REAL_DOCUMENT_CONTENT', editState: 'NON_EDIT', revision: 0 })
    // Another formula appears at index 0; A shifts to index 1 鈥?keyed by identity.
    const result = capture(hostA, { classification: 'REAL_DOCUMENT_CONTENT', editState: 'NON_EDIT', revision: 1 })
    expect(result.contentRevisionChanged).toBe(false)
    expect(getAuthoritativeSourceState(DOC, resolveStableFormulaIdentity(hostA))?.formulaContentRevision).toBe(1)
  })

  it('7. Formula0 remains source-matchable after insert (authoritative binding)', () => {
    const hostA = hostWithSource('x+y')
    const identityA = resolveStableFormulaIdentity(hostA)
    // After an insert, A is at index 1 with tag 11.2.2 鈥?same identity+source.
    const plan = buildAuthoritativePlan({
      entries: [
        { host: hostWithSource('new'), index: 0, tag: '11.2.1', identity: 999 },
        { host: hostA, index: 1, tag: '11.2.2', identity: identityA, hash: simpleHash('x+y') },
      ],
    })
    const auth = baseAuth(plan, 'x+y')
    expect(auth.decision).toBe('AUTHORIZED')
    expect(auth.uniqueAuthorizedFormulaIndex).toBe(1)
    expect(auth.authorityKind).toBe('STABLE_IDENTITY_AUTHORITATIVE_SOURCE_MATCH')
  })

  it('8. Formula1 remains source-matchable after order shift', () => {
    const hostB = hostWithSource('z-w')
    const identityB = resolveStableFormulaIdentity(hostB)
    const plan = buildAuthoritativePlan({
      entries: [{ host: hostB, index: 2, tag: '11.2.3', identity: identityB, hash: simpleHash('z-w') }],
    })
    const auth = baseAuth(plan, 'z-w')
    expect(auth.decision).toBe('AUTHORIZED')
    expect(auth.uniqueAuthorizedFormulaIndex).toBe(2)
  })

  it('9. edit-state enter/exit does not destroy source authority', () => {
    const host = hostWithSource('x+y')
    capture(host, { classification: 'REAL_DOCUMENT_CONTENT', editState: 'NON_EDIT' })
    const hash0 = getAuthoritativeSourceState(DOC, resolveStableFormulaIdentity(host))?.normalizedSourceHash
    // Enter edit (renderer mutation) then exit 鈥?same source preserved.
    capture(host, { classification: 'TYPOORA_RENDERER_INTERNAL_ONLY', editState: 'EDIT', tex: 'x+y' })
    capture(host, { classification: 'TYPOORA_RENDERER_INTERNAL_ONLY', editState: 'NON_EDIT', tex: 'x+y' })
    expect(getAuthoritativeSourceState(DOC, resolveStableFormulaIdentity(host))?.normalizedSourceHash).toBe(hash0)
    expect(getAuthoritativeSourceState(DOC, resolveStableFormulaIdentity(host))?.formulaContentRevision).toBe(1)
  })

  it('10. one editing host 鈫?stable identity resolved (candidateCount=1, planEntryFound, formulaIndex)', () => {
    const root = document.createElement('div')
    const hostA = hostWithSource('x+y')
    hostA.classList.add('md-focus')
    root.appendChild(hostA)
    const identityA = resolveStableFormulaIdentity(hostA)
    const plan = buildAuthoritativePlan({ entries: [{ host: hostA, index: 0, tag: '5.3.1', identity: identityA, hash: simpleHash('x+y') }] })
    const resolved = resolveCurrentEditingFormulaIdentity({ editorRoot: root, canonicalHosts: [{ host: hostA, formulaIndex: 0 }], plan })
    expect(resolved.candidateCount).toBe(1)
    expect(resolved.stableFormulaIdentity).toBe(identityA)
    expect(resolved.planEntryFound).toBe(true)
    expect(resolved.formulaIndex).toBe(0)
    expect(resolved.decision).toBe('PASS')
  })

  it('11. stable identity 鈫?plan entry 鈫?formulaIndex', () => {
    const root = document.createElement('div')
    const hostB = hostWithSource('z-w')
    hostB.classList.add('md-focus')
    root.appendChild(hostB)
    const identityB = resolveStableFormulaIdentity(hostB)
    const plan = buildAuthoritativePlan({ entries: [{ host: hostB, index: 1, tag: '11.2.1', identity: identityB, hash: simpleHash('z-w') }] })
    const resolved = resolveCurrentEditingFormulaIdentity({ editorRoot: root, canonicalHosts: [{ host: hostB, formulaIndex: 1 }], plan })
    expect(resolved.stableFormulaIdentity).toBe(identityB)
    expect(resolved.formulaIndex).toBe(1)
    expect(resolved.decision).toBe('PASS')
  })

  it('12. multiple editing hosts 鈫?AMBIGUOUS', () => {
    const root = document.createElement('div')
    const h1 = hostWithSource('a'); h1.classList.add('md-focus')
    const h2 = hostWithSource('b'); h2.classList.add('md-focus')
    root.appendChild(h1); root.appendChild(h2)
    const plan = buildAuthoritativePlan({ entries: [] })
    const resolved = resolveCurrentEditingFormulaIdentity({ editorRoot: root, canonicalHosts: [{ host: h1, formulaIndex: 0 }, { host: h2, formulaIndex: 1 }], plan })
    expect(resolved.candidateCount).toBe(2)
    expect(resolved.decision).toBe('AMBIGUOUS')
  })

  it('13. editing host outside canonical set 鈫?FAIL', () => {
    const root = document.createElement('div')
    const stranger = hostWithSource('foreign')
    stranger.classList.add('md-focus')
    root.appendChild(stranger)
    const plan = buildAuthoritativePlan({ entries: [] })
    const resolved = resolveCurrentEditingFormulaIdentity({ editorRoot: root, canonicalHosts: [{ host: hostWithSource('x+y'), formulaIndex: 0 }], plan })
    expect(resolved.candidateCount).toBe(1)
    expect(resolved.decision).toBe('FAIL')
    expect(resolved.reason).toBe('EDITING_HOST_OUTSIDE_CANONICAL_SET')
  })

  it('14. stale plan rebuild 鈫?old context discarded 鈫?new token (rebind PASS)', () => {
    const oldPlan = buildAuthoritativePlan({ entries: [], revision: 0 })
    let ctxToken = 0
    setTex2svgInjectionContext(makeCtx(oldPlan, () => 0, 'good', () => { ctxToken = 1 }))
    const result = handleTex2svgPreCall(['x+y'], null, '')
    // The rebuild installs a NEW context with token 1; the fresh plan contains
    // the input 鈫?post-catchup rebind + authorization.
    expect(result.decision).toBe('AUTHORIZED_AFTER_CATCHUP')
    expect(ctxToken).toBe(1)
  })

  it('15. plan updated but current live revision stale 鈫?rebind FAIL', () => {
    const oldPlan = buildAuthoritativePlan({ entries: [], revision: 0 })
    setTex2svgInjectionContext(makeCtx(oldPlan, () => 0, 'stale-revision'))
    const result = handleTex2svgPreCall(['x+y'], null, '')
    expect(result.decision).toBe('PASS_THROUGH')
  })

  it('16. context rebound + source match 鈫?AUTHORIZED', () => {
    const hostA = hostWithSource('x+y')
    const identityA = resolveStableFormulaIdentity(hostA)
    const plan = buildAuthoritativePlan({ entries: [{ host: hostA, index: 0, tag: '5.3.1', identity: identityA, hash: simpleHash('x+y') }] })
    const auth = baseAuth(plan, 'x+y', { editingHostIdentity: { candidateCount: 1, stableFormulaIdentity: identityA } })
    expect(auth.decision).toBe('AUTHORIZED')
    expect(auth.uniqueAuthorizedStableFormulaIdentity).toBe(identityA)
  })

  it('17. catchup completed no match 鈫?CATCHUP_COMPLETED_NOT_AUTHORIZED', () => {
    const oldPlan = buildAuthoritativePlan({ entries: [], revision: 0 })
    setTex2svgInjectionContext(makeCtx(oldPlan, () => 0, 'good'))
    const result = handleTex2svgPreCall(['R^2'], null, '')
    expect(result.decision).toBe('PASS_THROUGH')
    const stats = getCatchupStats()
    expect(stats.completedNotAuthorized).toBeGreaterThanOrEqual(1)
    expect(stats.completedAuthorized).toBe(0)
  })

  it('18. catchup only 鈫?newFormulaCatchupPass=false (no authorization)', () => {
    const oldPlan = buildAuthoritativePlan({ entries: [], revision: 0 })
    setTex2svgInjectionContext(makeCtx(oldPlan, () => 0, 'good'))
    handleTex2svgPreCall(['R^2'], null, '')
    const stats = getCatchupStats()
    expect(stats.completedAuthorized).toBe(0)
  })

  it('19. catchup + authorization + injection + fulfillment + visible 鈫?closure passed', () => {
    const oldPlan = buildAuthoritativePlan({ entries: [], revision: 0 })
    setTex2svgInjectionContext(makeCtx(oldPlan, () => 0, 'good'))
    const result = handleTex2svgPreCall(['x+y'], null, '')
    expect(result.decision).toBe('AUTHORIZED_AFTER_CATCHUP')
    expect(result.injection).not.toBeNull()
    // Simulate fulfillment with a node whose text contains the injected tag.
    const node = document.createElement('mjx-container')
    node.textContent = 'x+y(5.3.1)'
    reportInjectionFulfillment(result.injection!.callOrdinal, node, true)
    expect(getCatchupStats().closurePassedCount).toBeGreaterThanOrEqual(1)
  })

  it('20. affected=2 completed=0 blocked=2 鈫?unresolved=2', () => {
    setLiveUpdateTerminalState(5, 1, 'BLOCKED')
    setLiveUpdateTerminalState(5, 2, 'BLOCKED')
    const acc = computeLiveUpdateAccounting({ liveFormulaRevision: 5, affectedIdentities: [1, 2], safeSkippedIdentities: [], allDesiredTagsVisible: false })
    expect(acc.affectedCount).toBe(2)
    expect(acc.completedCount).toBe(0)
    expect(acc.blockedCount).toBe(2)
    expect(acc.unresolvedCount).toBe(2)
    expect(acc.decision).toBe('INCOMPLETE')
  })

  it('21. pending=0 blocked=2 鈫?final cannot PASS', () => {
    setLiveUpdateTerminalState(5, 1, 'BLOCKED')
    const acc = computeLiveUpdateAccounting({ liveFormulaRevision: 5, affectedIdentities: [1], safeSkippedIdentities: [], allDesiredTagsVisible: false })
    expect(acc.pendingCount).toBe(0)
    expect(acc.blockedCount).toBe(1)
    expect(acc.unresolvedCount).toBe(1)
    expect(acc.decision).toBe('INCOMPLETE')
  })

  it('22. completed=2 blocked=0 鈫?unresolved=0 (PASS when tags visible)', () => {
    setLiveUpdateTerminalState(5, 1, 'COMPLETED')
    setLiveUpdateTerminalState(5, 2, 'COMPLETED')
    const acc = computeLiveUpdateAccounting({ liveFormulaRevision: 5, affectedIdentities: [1, 2], safeSkippedIdentities: [], allDesiredTagsVisible: true })
    expect(acc.completedCount).toBe(2)
    expect(acc.unresolvedCount).toBe(0)
    expect(acc.decision).toBe('PASS')
  })

  it('23. caller observed but unsafe invoke 鈫?PARTIAL', () => {
    const hostA = hostWithSource('x+y')
    const identityA = resolveStableFormulaIdentity(hostA)
    const plan = buildAuthoritativePlan({ entries: [{ host: hostA, index: 0, tag: '5.3.1', identity: identityA, hash: simpleHash('x+y') }] })
    setTex2svgInjectionContext(makeCtx(plan, () => 1))
    handleTex2svgPreCall(['x+y'], null, 'stack\n    at typoraAppRender (typora://app/typemark/appsrc/window/frame.js:1:1)')
    expect(getCallsiteAuthorityDecision()).toBe('PARTIAL')
  })

  it('24. no callsite observed yet 鈫?NOT_REPORTED (never PASS)', () => {
    expect(getCallsiteAuthorityDecision()).toBe('NOT_REPORTED')
  })

  it('25. safe trigger cannot be claimed without proof 鈫?authority stays PARTIAL', () => {
    const hostA = hostWithSource('x+y')
    const identityA = resolveStableFormulaIdentity(hostA)
    const plan = buildAuthoritativePlan({ entries: [{ host: hostA, index: 0, tag: '5.3.1', identity: identityA, hash: simpleHash('x+y') }] })
    setTex2svgInjectionContext(makeCtx(plan, () => 1))
    handleTex2svgPreCall(['x+y'], null, '')
    // The read-only callsite audit never fabricates safeToInvoke=true.
    expect(getCallsiteAuthorityDecision()).not.toBe('PASS')
  })

  it('26. renderer mutation 鈫?no source/content/structure revision change', () => {
    const s1 = snapshot([{ host: hostWithSource('x+y'), formulaIndex: 0, documentOrder: 0, desiredTag: '5.3.1', chapterOrdinal: 11, sectionOrdinal: 2, sequenceValue: 1, sourceKind: 'RAWBLOCK_SOURCE_CONTAINER', normalizedSourceHash: simpleHash('x+y'), normalizedSourcePrefix: '', managedEligible: true, formulaContentRevision: 1 }])
    recordSemanticBaseline({ documentKey: DOC, documentGeneration: 1, diskSourceSha256: 'SHA', snapshot: s1 })
    const s2 = snapshot([{ host: hostWithSource('x+y'), formulaIndex: 0, documentOrder: 0, desiredTag: '5.3.1', chapterOrdinal: 11, sectionOrdinal: 2, sequenceValue: 1, sourceKind: 'RAWBLOCK_SOURCE_CONTAINER', normalizedSourceHash: simpleHash('visual-drift'), normalizedSourcePrefix: '', managedEligible: true, formulaContentRevision: 1 }])
    const result = advanceLiveRevision({
      documentKey: DOC,
      documentGeneration: 1,
      diskSourceSha256: 'SHA',
      mutationClassification: 'TYPOORA_RENDERER_INTERNAL_ONLY',
      snapshot: s2,
      previousSnapshotCount: 1,
    })
    expect(result.decision).toBe('IGNORED_RENDERER_INTERNAL')
  })
})

describe('Edit Session Source Commit Barrier (v2.5.7-R5.4.3.8)', () => {
  beforeEach(() => {
    resetAuthoritativeSourceStates()
    resetLiveRevisionState()
    resetIdentityTokens()
    resetEditSessionState()
  })

  it('E1. click-only with latched session 鈫?hash-diff commit BLOCKED, revision unchanged', () => {
    const host = hostWithSource('x+y')
    const identity = resolveStableFormulaIdentity(host)
    capture(host, { classification: 'REAL_DOCUMENT_CONTENT', editState: 'NON_EDIT' })
    const before = getAuthoritativeSourceState(DOC, identity)!
    // User clicks the formula — Typora enters edit state; candidate hash drifts
    // (edit-state DOM). No explicit input observed yet.
    latchEditSession({
      documentKey: DOC, generation: 2, rootToken: 1,
      stableFormulaIdentity: identity, formulaHostToken: 9, formulaIndex: 0,
      desiredTag: '11.2.2', sourceHashAtEnter: before.normalizedSourceHash,
      contentRevisionAtEnter: before.formulaContentRevision,
      trigger: 'POINTERDOWN_CANONICAL_HOST',
    })
    const result = capture(host, {
      classification: 'REAL_DOCUMENT_CONTENT',
      editState: 'EDIT',
      tex: 'x+y+z', // edit-state DOM drift candidate
    })
    expect(result.overwriteBlocked).toBe(true)
    expect(result.userSemanticSourceChange).toBe(false)
    const after = getAuthoritativeSourceState(DOC, identity)!
    expect(after.normalizedSourceHash).toBe(before.normalizedSourceHash)
    expect(after.formulaContentRevision).toBe(before.formulaContentRevision)
  })

  it('F1. explicit input observed 鈫?hash-diff commit allowed, revision +1', () => {
    const host = hostWithSource('x+y')
    const identity = resolveStableFormulaIdentity(host)
    capture(host, { classification: 'REAL_DOCUMENT_CONTENT', editState: 'NON_EDIT' })
    const before = getAuthoritativeSourceState(DOC, identity)!
    const session = latchEditSession({
      documentKey: DOC, generation: 2, rootToken: 1,
      stableFormulaIdentity: identity, formulaHostToken: 9, formulaIndex: 0,
      desiredTag: '11.2.2', sourceHashAtEnter: before.normalizedSourceHash,
      contentRevisionAtEnter: before.formulaContentRevision,
      trigger: 'POINTERDOWN_CANONICAL_HOST',
    })
    markSessionExplicitInput(session)
    const result = capture(host, {
      classification: 'REAL_DOCUMENT_CONTENT',
      editState: 'EDIT',
      tex: 'x+y+z',
    })
    expect(result.overwriteBlocked).toBe(false)
    expect(result.userSemanticSourceChange).toBe(true)
    expect(result.contentRevisionChanged).toBe(true)
    const after = getAuthoritativeSourceState(DOC, identity)!
    expect(after.formulaContentRevision).toBe(before.formulaContentRevision + 1)
    expect(after.normalizedSourceHash).toBe(simpleHash('x+y+z'))
  })

  it('G1. session targets another identity 鈫?barrier not applied', () => {
    const host = hostWithSource('x+y')
    const identity = resolveStableFormulaIdentity(host)
    capture(host, { classification: 'REAL_DOCUMENT_CONTENT', editState: 'NON_EDIT' })
    // Latch a DIFFERENT formula identity.
    latchEditSession({
      documentKey: DOC, generation: 2, rootToken: 1,
      stableFormulaIdentity: 777, formulaHostToken: 8, formulaIndex: 3,
      desiredTag: '11.2.4', sourceHashAtEnter: null, contentRevisionAtEnter: 0,
      trigger: 'POINTERDOWN_CANONICAL_HOST',
    })
    const result = capture(host, { classification: 'REAL_DOCUMENT_CONTENT', editState: 'EDIT', tex: 'x+y+z' })
    expect(result.overwriteBlocked).toBe(false)
    expect(result.userSemanticSourceChange).toBe(true)
  })
})

function makeCtx(
  plan: FormulaRenderAuthorizationPlan | null,
  token: () => number,
  rebuildMode: 'good' | 'stale-revision' = 'good',
  onRebuild?: () => void,
): Tex2svgInjectionRuntimeContext {
  const rebuildPlanSynchronously = (): boolean => {
    onRebuild?.()
    const hostA = hostWithSource('x+y')
    const identityA = resolveStableFormulaIdentity(hostA)
    if (rebuildMode === 'stale-revision') {
      // Rebuild installs a plan bound to revision 2 while the context reports
      // live revision 1 鈫?post-catchup live-freshness check fails 鈫?rebind FAIL.
      const stale = buildAuthoritativePlan({ entries: [{ host: hostA, index: 0, tag: '5.3.1', identity: identityA, hash: simpleHash('x+y') }], revision: 2 })
      setTex2svgInjectionContext(makeCtx(stale, () => 1, 'stale-revision'))
      return true
    }
    // 'good': install a FRESH context (new token) with the target formula so
    // authorization can close after catch-up.
    const fresh = buildAuthoritativePlan({ entries: [{ host: hostA, index: 0, tag: '5.3.1', identity: identityA, hash: simpleHash('x+y') }], revision: 1 })
    setTex2svgInjectionContext(makeCtx(fresh, () => 1, 'good'))
    return true
  }
  return {
    enabled: true,
    plan,
    getWorkspaceActivePath: () => 'C:/vault/a.md',
    getDocumentKey: () => DOC,
    getDocumentSourceSha256: () => 'SHA-X',
    getEditorRoot: () => null,
    getCurrentGeneration: () => 2,
    getCurrentLiveFormulaRevision: () => 1,
    getCurrentSemanticSignature: () => 'S1',
    rebuildPlanSynchronously,
    getContextToken: token,
  }
}

