// @vitest-environment jsdom
/**
 * v2.5.7-R5.4.3.7 Unit Tests: Persistent Formula Renderer Projection +
 * Typora Renderer Mutation Reconciliation + Pending New Formula Projection Replay.
 */
import { describe, it, expect, beforeEach } from 'vitest'
import {
  readVisibleFormulaTag,
  reconcileFormulaRenderProjectionNow,
  createPendingProjection,
  getPendingProjection,
  resolvePendingProjection,
  clearPendingProjectionsForDocument,
  resetPendingProjections,
} from './formula-render-projection'
import { latchEditSession, resetEditSessionState } from './formula-edit-session'

function makeHost(visibleText?: string): HTMLElement {
  const host = document.createElement('div')
  host.className = 'mathjax-block md-end-block md-math-block md-rawblock'
  if (visibleText) {
    const c = document.createElement('mjx-container')
    c.className = 'MathJax'
    c.textContent = visibleText
    host.appendChild(c)
  }
  document.body.appendChild(host)
  return host
}

function makeInput(overrides: Partial<Parameters<typeof reconcileFormulaRenderProjectionNow>[0]> = {}) {
  return {
    documentKey: 'docA',
    documentGeneration: 2,
    editorRootToken: 1,
    stableFormulaIdentity: 42,
    formulaIndex: 1,
    formulaHost: makeHost('(1)'),
    desiredTag: '11.2.1',
    reason: 'test',
    ...overrides,
  }
}

describe('Read Visible Formula Tag (v2.5.7-R5.4.3.7)', () => {
  beforeEach(() => {
    document.body.innerHTML = ''
    resetPendingProjections()
  })

  it('A1. MATCH when visible equals desired', () => {
    const host = makeHost('(11.2.1)')
    expect(readVisibleFormulaTag(host, '11.2.1').decision).toBe('MATCH')
  })

  it('A2. MISMATCH when visible differs', () => {
    const host = makeHost('(1)')
    expect(readVisibleFormulaTag(host, '11.2.1').decision).toBe('MISMATCH')
  })

  it('A3. NO_VISIBLE_OUTPUT when no mjx-container', () => {
    const host = makeHost()
    expect(readVisibleFormulaTag(host, '11.2.1').decision).toBe('NO_VISIBLE_OUTPUT')
  })
})

describe('Renderer Mutation does NOT advance semantic revision (v2.5.7-R5.4.3.7)', () => {
  beforeEach(() => {
    document.body.innerHTML = ''
    resetPendingProjections()
  })

  it('B1. Typora replaces MJX output -> projection reconcile requested, semantic refresh NOT requested', () => {
    // The observer classification is tested in caption-service; here we prove
    // reconcile itself never returns a semantic signal.
    const host = makeHost('(1)')
    const result = reconcileFormulaRenderProjectionNow(makeInput({ formulaHost: host }))
    expect(result.projectionMatched).toBe(false)
    expect(result.reconcileRequested).toBe(true)
    // reconcile must not mutate the host's mjx count on its own synchronously.
    expect(host.querySelectorAll('mjx-container').length).toBe(1)
  })

  it('B2. visible==desired -> NO_OP (no re-render)', () => {
    const result = reconcileFormulaRenderProjectionNow(makeInput({ formulaHost: makeHost('(11.2.1)') }))
    expect(result.projectionMatched).toBe(true)
    expect(result.reconcileRequested).toBe(false)
    expect(result.route).toBe('NO_OP')
  })

  it('C1. Projection-owned replacement does not recurse', () => {
    // Strategy B with a stub fulfillment provider that replaces the single
    // native output. After replacement, visible tag matches.
    const host = makeHost('(1)')
    let replaced = false
    const result = reconcileFormulaRenderProjectionNow(makeInput({
      formulaHost: host,
      desiredTag: '11.2.1',
      authoritativeRawTex: 'x+y',
      requestFulfillment: async () => {
        const node = document.createElement('mjx-container')
        node.className = 'MathJax'
        node.textContent = '(11.2.1)'
        replaced = true
        return node
      },
    }))
    expect(result.route).toBe('STRATEGY_B_EXACT_FULFILLMENT')
    expect(replaced).toBe(true)
  })
})

describe('Pending New Formula Projection (v2.5.7-R5.4.3.7)', () => {
  beforeEach(() => {
    document.body.innerHTML = ''
    resetPendingProjections()
  })

  it('D1. first render before identity -> pending created', () => {
    const p = createPendingProjection({
      documentKey: 'docA',
      generation: 2,
      rootToken: 1,
      formulaHostToken: 7,
      rendererNodeToken: 3,
      operationId: 'op-1',
      reason: 'NATURAL_RENDER_BEFORE_PLAN',
    })
    expect(p.state).toBe('PENDING_IDENTITY')
    expect(getPendingProjection(7)).toBe(p)
  })

  it('D2. FORMULA_ADDED establishes desiredTag -> REPLAY', () => {
    createPendingProjection({
      documentKey: 'docA', generation: 2, rootToken: 1,
      formulaHostToken: 7, rendererNodeToken: 3,
      operationId: 'op-1', reason: 'NATURAL_RENDER_BEFORE_PLAN',
    })
    const decision = resolvePendingProjection({
      formulaHostToken: 7,
      documentKey: 'docA',
      generation: 2,
      stableFormulaIdentity: 50,
      formulaIndex: 2,
      desiredTag: '11.2.1',
    })
    expect(decision).toBe('REPLAY')
    expect(getPendingProjection(7)).toBeNull()
  })

  it('E1. pending cancelled on document switch -> STALE, no DOM write', () => {
    createPendingProjection({
      documentKey: 'docA', generation: 2, rootToken: 1,
      formulaHostToken: 7, rendererNodeToken: 3,
      operationId: 'op-1', reason: 'NATURAL_RENDER_BEFORE_PLAN',
    })
    const decision = resolvePendingProjection({
      formulaHostToken: 7,
      documentKey: 'docB', // switched
      generation: 3,
      stableFormulaIdentity: 50,
      formulaIndex: 2,
      desiredTag: '11.2.1',
    })
    expect(decision).toBe('STALE')
  })

  it('E2. clearPendingProjectionsForDocument cancels', () => {
    createPendingProjection({
      documentKey: 'docA', generation: 2, rootToken: 1,
      formulaHostToken: 7, rendererNodeToken: 3,
      operationId: 'op-1', reason: 'x',
    })
    clearPendingProjectionsForDocument('docA')
    expect(getPendingProjection(7)).toBeNull()
  })
})

describe('Strategy B Hard Gate (v2.5.7-R5.4.3.7)', () => {
  beforeEach(() => {
    document.body.innerHTML = ''
    resetPendingProjections()
  })

  it('F1. missing stable identity -> ABORT', () => {
    const result = reconcileFormulaRenderProjectionNow(makeInput({ stableFormulaIdentity: null }))
    expect(result.route).toBe('ABORT')
  })

  it('F2. missing desiredTag -> ABORT', () => {
    const result = reconcileFormulaRenderProjectionNow(makeInput({ desiredTag: '' }))
    expect(result.route).toBe('ABORT')
  })

  it('F3. ambiguous output -> ABORT', () => {
    const host = makeHost('(1)')
    const extra = document.createElement('mjx-container')
    extra.textContent = '(2)'
    host.appendChild(extra)
    const result = reconcileFormulaRenderProjectionNow(makeInput({ formulaHost: host }))
    expect(result.route).toBe('ABORT')
  })
})

describe('Edit-Safe Projection Hard Gate (v2.5.7-R5.4.3.8)', () => {
  beforeEach(() => {
    document.body.innerHTML = ''
    resetPendingProjections()
    resetEditSessionState()
    window.getSelection()?.removeAllRanges()
  })

  it('J1. editing formula with safe selection -> SAFE gate passes, Strategy B runs', () => {
    const host = makeHost('(1)')
    const identity = 42
    latchEditSession({
      documentKey: 'docA', generation: 2, rootToken: 1,
      stableFormulaIdentity: identity, formulaHostToken: 9, formulaIndex: 1,
      desiredTag: '11.2.1', sourceHashAtEnter: 'H', contentRevisionAtEnter: 1,
      trigger: 'POINTERDOWN_CANONICAL_HOST',
    })
    // Selection inside the visible output, activeElement outside the replacement.
    const container = host.querySelector('mjx-container')!
    const range = document.createRange()
    range.selectNodeContents(container)
    window.getSelection()?.addRange(range)
    document.body.appendChild(document.createElement('input')) // keep activeElement = body (jsdom)
    const result = reconcileFormulaRenderProjectionNow(makeInput({
      formulaHost: host,
      desiredTag: '11.2.1',
      authoritativeRawTex: 'x+y',
      requestFulfillment: async () => {
        const node = document.createElement('mjx-container')
        node.className = 'MathJax'
        node.textContent = '(11.2.1)'
        return node
      },
    }))
    expect(result.route).toBe('STRATEGY_B_EXACT_FULFILLMENT')
  })

  it('J2. editing formula but selection snapshot unavailable -> ABORT', () => {
    const host = makeHost('(1)')
    latchEditSession({
      documentKey: 'docA', generation: 2, rootToken: 1,
      stableFormulaIdentity: 42, formulaHostToken: 9, formulaIndex: 1,
      desiredTag: '11.2.1', sourceHashAtEnter: 'H', contentRevisionAtEnter: 1,
      trigger: 'POINTERDOWN_CANONICAL_HOST',
    })
    // No range added -> anchorNode null -> selection unavailable.
    const result = reconcileFormulaRenderProjectionNow(makeInput({
      formulaHost: host,
      desiredTag: '11.2.1',
      authoritativeRawTex: 'x+y',
      requestFulfillment: async () => document.createElement('mjx-container'),
    }))
    expect(result.route).toBe('ABORT')
    expect(result.reason).toBe('EDIT_SAFE_GATE_ABORTED')
  })

  it('J3. non-editing formula is NOT gated by the edit-safe hard gate', () => {
    const host = makeHost('(1)')
    const result = reconcileFormulaRenderProjectionNow(makeInput({
      formulaHost: host,
      desiredTag: '11.2.1',
      authoritativeRawTex: 'x+y',
      requestFulfillment: async () => {
        const node = document.createElement('mjx-container')
        node.className = 'MathJax'
        node.textContent = '(11.2.1)'
        return node
      },
    }))
    // No latched session -> Strategy B proceeds without the editing gate.
    expect(result.route).toBe('STRATEGY_B_EXACT_FULFILLMENT')
  })
})
