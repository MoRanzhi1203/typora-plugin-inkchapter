// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest'
import {
  probeMathJaxApiAuthority,
  createSingleTargetSession,
  clearSingleTargetSession,
  finalizeSingleTargetSession,
  getActiveSingleTargetSession,
  tokenFor,
  R5_RUNTIME_MARKER,
} from './mathjax-native-tag-injection'

describe('probeMathJaxApiAuthority', () => {
  beforeEach(() => {
    // Clear any existing MathJax mock
    delete (window as any).MathJax
  })

  it('typesetClear/typesetPromise/getMathItemsWithin all callable → PASS', () => {
    (window as any).MathJax = {
      typesetClear: () => {},
      typesetPromise: () => {},
      startup: {
        document: {
          getMathItemsWithin: () => [],
        },
      },
    }
    const result = probeMathJaxApiAuthority()
    expect(result.decision).toBe('PASS')
    expect(result.typesetClearCallable).toBe(true)
    expect(result.typesetPromiseCallable).toBe(true)
    expect(result.getMathItemsWithinCallable).toBe(true)
  })

  it('missing typesetClear → FAIL', () => {
    (window as any).MathJax = {
      typesetPromise: () => {},
      startup: { document: { getMathItemsWithin: () => [] } },
    }
    expect(probeMathJaxApiAuthority().decision).toBe('FAIL')
  })

  it('missing typesetPromise → FAIL', () => {
    (window as any).MathJax = {
      typesetClear: () => {},
      startup: { document: { getMathItemsWithin: () => [] } },
    }
    expect(probeMathJaxApiAuthority().decision).toBe('FAIL')
  })

  it('missing getMathItemsWithin → FAIL', () => {
    (window as any).MathJax = {
      typesetClear: () => {},
      typesetPromise: () => {},
      startup: { document: {} },
    }
    expect(probeMathJaxApiAuthority().decision).toBe('FAIL')
  })
})

describe('createSingleTargetSession', () => {
  beforeEach(() => {
    clearSingleTargetSession('test-cleanup')
  })

  it('targetCount=1 → session created PASS', () => {
    const host = document.createElement('div')
    const session = createSingleTargetSession('CLEAR_AND_RETYPESSET', 0, host, '5.3.1', 'docA', 1, 1, 'abc123', 1)
    expect(session).not.toBeNull()
    expect(session!.formulaIndex).toBe(0)
    expect(session!.desiredTag).toBe('5.3.1')
    expect(session!.active).toBe(true)
    expect(session!.requestId).toMatch(/^st-/)
  })

  it('reentrancy gate: active session → null', () => {
    const host = document.createElement('div')
    createSingleTargetSession('CLEAR_AND_RETYPESSET', 0, host, '5.3.1', 'docA', 1, 1, 'abc', 1)
    const second = createSingleTargetSession('CLEAR_AND_RETYPESSET', 1, host, '11.2.1', 'docA', 1, 1, 'def', 1)
    expect(second).toBeNull()
  })

  it('getActiveSingleTargetSession returns the active session', () => {
    const host = document.createElement('div')
    const session = createSingleTargetSession('CLEAR_AND_RETYPESSET', 0, host, '5.3.1', 'docA', 1, 1, 'abc', 1)
    expect(getActiveSingleTargetSession()).toBe(session)
  })
})

describe('clearSingleTargetSession', () => {
  beforeEach(() => {
    clearSingleTargetSession('test-cleanup')
  })

  it('session clear → activeAfter=false', () => {
    const host = document.createElement('div')
    const session = createSingleTargetSession('CLEAR_AND_RETYPESSET', 0, host, '5.3.1', 'docA', 1, 1, 'abc', 1)
    expect(session!.active).toBe(true)
    clearSingleTargetSession('COMPLETE')
    expect(getActiveSingleTargetSession()).toBeNull()
  })
})

describe('finalizeSingleTargetSession', () => {
  beforeEach(() => {
    clearSingleTargetSession('test-cleanup')
  })

  it('injected=true, duplicate=0, count=1 → PASS', () => {
    const host = document.createElement('div')
    createSingleTargetSession('CLEAR_AND_RETYPESSET', 0, host, '5.3.1', 'docA', 1, 1, null, 1)
    const session = getActiveSingleTargetSession()!
    session.preFilterManagedCallCount = 1
    session.injectionAuthorized = true

    const result = finalizeSingleTargetSession(true, 0, 1)
    expect(result.decision).toBe('PASS')
  })

  it('injected=false → FAIL', () => {
    const host = document.createElement('div')
    createSingleTargetSession('CLEAR_AND_RETYPESSET', 0, host, '5.3.1', 'docA', 1, 1, null, 1)
    const session = getActiveSingleTargetSession()!
    session.preFilterManagedCallCount = 1
    session.injectionAuthorized = false

    const result = finalizeSingleTargetSession(false, 0, 1)
    expect(result.decision).toBe('FAIL')
  })

  it('duplicateOutputCount>0 → FAIL', () => {
    const host = document.createElement('div')
    createSingleTargetSession('CLEAR_AND_RETYPESSET', 0, host, '5.3.1', 'docA', 1, 1, null, 1)
    const session = getActiveSingleTargetSession()!
    session.preFilterManagedCallCount = 1
    session.injectionAuthorized = true

    const result = finalizeSingleTargetSession(true, 2, 1)
    expect(result.decision).toBe('FAIL')
  })

  it('mathItemsAfterRetypesetCount != 1 → FAIL', () => {
    const host = document.createElement('div')
    createSingleTargetSession('CLEAR_AND_RETYPESSET', 0, host, '5.3.1', 'docA', 1, 1, null, 1)
    const session = getActiveSingleTargetSession()!
    session.preFilterManagedCallCount = 1
    session.injectionAuthorized = true

    const result = finalizeSingleTargetSession(true, 0, 0)
    expect(result.decision).toBe('FAIL')
  })

  it('no active session → FAIL', () => {
    const result = finalizeSingleTargetSession(true, 0, 1)
    expect(result.decision).toBe('FAIL')
  })
})

describe('tokenFor', () => {
  it('returns stable token for the same element', () => {
    const el = document.createElement('div')
    const t1 = tokenFor(el)
    const t2 = tokenFor(el)
    expect(t1).toBe(t2)
  })

  it('returns different token for different elements', () => {
    const el1 = document.createElement('div')
    const el2 = document.createElement('div')
    expect(tokenFor(el1)).not.toBe(tokenFor(el2))
  })
})

describe('R5 Runtime Marker', () => {
  it('marker string is correct', () => {
    expect(R5_RUNTIME_MARKER).toBe('FORMULA-SINGLE-TARGET-RETYPESSET-V2.5.7-R5')
  })
})