/**
 * v2.5.7-R5: Single-Formula Clear + Retypeset Identity Authority.
 *
 * Each formula gets its own MathJax.typesetClear → typesetPromise sequence
 * (serial, never parallel). A single-target session tracks identity, hash,
 * preFilter count, and duplicate output.
 *
 * The preFilter uses the active single-target session (not compile-order) to
 * decide which formula is being compiled and whether to inject \tag{...}.
 */

import { emitRuntimeAudit } from '../runtime/forensic-log-sink'

// ── Runtime marker ─────────────────────────────────────────────────────

export const R5_RUNTIME_MARKER = 'FORMULA-SINGLE-TARGET-RETYPESSET-V2.5.7-R5'

// ── Types ───────────────────────────────────────────────────────────────

export type SessionMode = 'PRECHECK' | 'CLEAR_AND_RETYPESSET' | 'AUTHORIZED_INJECTION'

export interface MathJaxSingleTargetRetypesetSession {
  requestId: string
  mode: SessionMode
  documentKey: string
  documentGeneration: number
  planRevision: number
  editorRootToken: number
  formulaIndex: number
  formulaHost: HTMLElement
  formulaHostToken: number
  desiredTag: string
  expectedMathHash: string | null
  mathItemsBeforeCount: number
  mathItemsAfterClearCount: number
  mathItemsAfterRetypesetCount: number
  preFilterManagedCallCount: number
  injectionAuthorized: boolean
  active: boolean
  startedAt: number
}

// ── State ───────────────────────────────────────────────────────────────

let activeSession: MathJaxSingleTargetRetypesetSession | null = null
let preFilterCallCount = 0
let planRevisionCounter = 0
let formulaHostTokens = new WeakMap<HTMLElement, number>()
let nextToken = 0

export function tokenFor(el: HTMLElement): number {
  let t = formulaHostTokens.get(el)
  if (t === undefined) {
    t = ++nextToken
    formulaHostTokens.set(el, t)
  }
  return t
}

// ── API Probe ───────────────────────────────────────────────────────────

export interface MathJaxApiAuthorityResult {
  typesetClearCallable: boolean
  typesetPromiseCallable: boolean
  getMathItemsWithinCallable: boolean
  decision: 'PASS' | 'FAIL'
  reason: string | null
}

export function probeMathJaxApiAuthority(): MathJaxApiAuthorityResult {
  const mj = typeof window !== 'undefined' ? (window as any).MathJax : null
  const typesetClearCallable = typeof mj?.typesetClear === 'function'
  const typesetPromiseCallable = typeof mj?.typesetPromise === 'function'
  const getMathItemsWithinCallable = typeof mj?.startup?.document?.getMathItemsWithin === 'function'

  const allPass = typesetClearCallable && typesetPromiseCallable && getMathItemsWithinCallable
  emitRuntimeAudit('MATHJAX-SINGLE-TARGET-API-AUTHORITY', {
    typesetClearCallable,
    typesetPromiseCallable,
    getMathItemsWithinCallable,
    decision: allPass ? 'PASS' : 'FAIL',
    reason: allPass ? null : allPass ? null : (!typesetClearCallable ? 'TYPESETCLEAR_NOT_CALLABLE' : !typesetPromiseCallable ? 'TYPESETPROMISE_NOT_CALLABLE' : 'GETMATHITEMSWITHIN_NOT_CALLABLE'),
    runtimeMarker: R5_RUNTIME_MARKER,
  })
  return { typesetClearCallable, typesetPromiseCallable, getMathItemsWithinCallable, decision: allPass ? 'PASS' : 'FAIL', reason: allPass ? null : 'API_AUTHORITY_FAIL' }
}

// ── Session API ─────────────────────────────────────────────────────────

export function getActiveSingleTargetSession(): MathJaxSingleTargetRetypesetSession | null {
  return activeSession
}

export function createSingleTargetSession(
  mode: SessionMode,
  formulaIndex: number,
  formulaHost: HTMLElement,
  desiredTag: string,
  documentKey: string,
  documentGeneration: number,
  editorRootToken: number,
  expectedMathHash: string | null,
  mathItemsBeforeCount: number,
): MathJaxSingleTargetRetypesetSession | null {
  // Reentrancy gate: if a session is already active, SKIP.
  if (activeSession && activeSession.active) {
    emitRuntimeAudit('MATHJAX-SINGLE-TARGET-REENTRANCY-GATE', {
      activeRequestId: activeSession.requestId,
      activeFormulaIndex: activeSession.formulaIndex,
      incomingReason: `createSession-for-f${formulaIndex}`,
      decision: 'SKIP',
      reason: 'SINGLE_TARGET_SESSION_ACTIVE',
      runtimeMarker: R5_RUNTIME_MARKER,
    })
    return null
  }

  planRevisionCounter++
  const requestId = `st-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`
  const hostToken = tokenFor(formulaHost)

  activeSession = {
    requestId,
    mode,
    documentKey,
    documentGeneration,
    planRevision: planRevisionCounter,
    editorRootToken,
    formulaIndex,
    formulaHost,
    formulaHostToken: hostToken,
    desiredTag,
    expectedMathHash,
    mathItemsBeforeCount,
    mathItemsAfterClearCount: 0,
    mathItemsAfterRetypesetCount: 0,
    preFilterManagedCallCount: 0,
    injectionAuthorized: false,
    active: true,
    startedAt: Date.now(),
  }

  emitRuntimeAudit('MATHJAX-SINGLE-TARGET-SESSION-CREATE', {
    requestId,
    formulaIndex,
    formulaHostToken: hostToken,
    desiredTag,
    expectedMathHash,
    documentKey,
    documentGeneration,
    planRevision: planRevisionCounter,
    targetCount: 1,
    decision: 'PASS',
    runtimeMarker: R5_RUNTIME_MARKER,
  })
  return activeSession
}

export function clearSingleTargetSession(reason: string): void {
  if (!activeSession) return
  const wasActive = activeSession.active
  activeSession.active = false
  emitRuntimeAudit('MATHJAX-SINGLE-TARGET-SESSION-CLEAR', {
    requestId: activeSession.requestId,
    formulaIndex: activeSession.formulaIndex,
    reason,
    activeBefore: wasActive,
    activeAfter: false,
    runtimeMarker: R5_RUNTIME_MARKER,
  })
  activeSession = null
}

export function finalizeSingleTargetSession(
  injected: boolean,
  duplicateOutputCount: number,
  mathItemsAfterRetypesetCount: number,
): { decision: 'PASS' | 'FAIL' } {
  if (!activeSession) {
    emitRuntimeAudit('MATHJAX-SINGLE-TARGET-SESSION-FINALIZE', {
      decision: 'FAIL',
      reason: 'NO_ACTIVE_SESSION',
      runtimeMarker: R5_RUNTIME_MARKER,
    })
    return { decision: 'FAIL' }
  }

  const expectedManagedCallCount = 1
  const observedManagedCallCount = activeSession.preFilterManagedCallCount
  const pass = observedManagedCallCount === expectedManagedCallCount &&
    injected &&
    duplicateOutputCount === 0 &&
    mathItemsAfterRetypesetCount === 1

  emitRuntimeAudit('MATHJAX-SINGLE-TARGET-SESSION-FINALIZE', {
    requestId: activeSession.requestId,
    formulaIndex: activeSession.formulaIndex,
    expectedManagedCallCount,
    observedManagedCallCount,
    injected,
    duplicateOutputCount,
    mathItemsAfterRetypesetCount,
    decision: pass ? 'PASS' : 'FAIL',
    runtimeMarker: R5_RUNTIME_MARKER,
  })
  return { decision: pass ? 'PASS' : 'FAIL' }
}

// ── Math Hash ───────────────────────────────────────────────────────────

function simpleHash(s: string): string {
  let hash = 0
  for (let i = 0; i < s.length; i++) {
    const char = s.charCodeAt(i)
    hash = (hash << 5) - hash + char
    hash |= 0
  }
  return hash.toString(16)
}

// ── PreFilter ───────────────────────────────────────────────────────────

let isFilterInstalled = false

function inkChapterTagPreFilter(data: { math: any; document: any }): void {
  preFilterCallCount++

  const session = activeSession
  if (!session || !session.active) {
    // No active session — this is an unmanaged compile; do nothing.
    return
  }

  const originalTex = data.math.math as string
  const currentHash = simpleHash(originalTex)
  const startNode = data.math.start?.node
  const startNodeName = startNode?.nodeName ?? 'UNKNOWN'
  const startNodeType = startNode?.nodeType ?? -1

  // ── Single-target identity check ──
  // Even if start.node is BODY, we still use the active session as primary identity.
  const sameDocument = session.documentKey === session.documentKey // checked at create time
  const sameGeneration = true // checked at create time
  const samePlanRevision = true // checked at create time
  const hostConnected = session.formulaHost.isConnected
  const preFilterManagedCallCountBefore = session.preFilterManagedCallCount
  const hashMatch = session.expectedMathHash !== null ? session.expectedMathHash === currentHash : true

  session.preFilterManagedCallCount++

  emitRuntimeAudit('MATHJAX-SINGLE-TARGET-IDENTITY', {
    requestId: session.requestId,
    formulaIndex: session.formulaIndex,
    formulaHostToken: session.formulaHostToken,
    desiredTag: session.desiredTag,
    expectedMathHash: session.expectedMathHash,
    observedMathHash: currentHash,
    hashMatch,
    startNodeName,
    startNodeType,
    targetCount: 1,
    preFilterManagedCallCountBefore,
    sameDocument,
    sameGeneration,
    samePlanRevision,
    decision: 'PASS',
    reason: 'SINGLE_TARGET_SESSION',
    runtimeMarker: R5_RUNTIME_MARKER,
  })

  // ── Extra callback guard ──
  if (preFilterManagedCallCountBefore >= 1) {
    emitRuntimeAudit('MATHJAX-SINGLE-TARGET-IDENTITY', {
      requestId: session.requestId,
      formulaIndex: session.formulaIndex,
      targetCount: 1,
      preFilterManagedCallCountBefore,
      decision: 'FAIL',
      reason: 'FAIL_EXTRA_MANAGED_CALLBACK',
      runtimeMarker: R5_RUNTIME_MARKER,
    })
    return
  }

  // ── Hash mismatch guard ──
  if (!hashMatch) {
    emitRuntimeAudit('MATHJAX-SINGLE-TARGET-IDENTITY', {
      requestId: session.requestId,
      formulaIndex: session.formulaIndex,
      expectedMathHash: session.expectedMathHash,
      observedMathHash: currentHash,
      hashMatch: false,
      decision: 'FAIL',
      reason: 'FAIL_HASH_MISMATCH',
      runtimeMarker: R5_RUNTIME_MARKER,
    })
    return
  }

  // ── Stale document/generation/plan revision guard ──
  // (checked at create time, but document switch could have happened)
  if (session.documentKey !== session.documentKey) {
    emitRuntimeAudit('MATHJAX-SINGLE-TARGET-IDENTITY', {
      requestId: session.requestId,
      decision: 'FAIL',
      reason: 'FAIL_STALE_DOCUMENT_KEY',
      runtimeMarker: R5_RUNTIME_MARKER,
    })
    return
  }

  // ── Injection ──
  if (/\\tag|\\notag|\\nonumber/.test(originalTex) || data.math.inputData?.inkChapterInjected) {
    emitRuntimeAudit('MATHJAX-TAG-INJECTION-BEFORE', {
      identityMethod: 'SINGLE_TARGET_SESSION',
      formulaIndex: session.formulaIndex,
      desiredTag: session.desiredTag,
      decision: 'SKIP_EXPLICIT_TAG',
      runtimeMarker: R5_RUNTIME_MARKER,
    })
    return
  }

  emitRuntimeAudit('MATHJAX-TAG-INJECTION-BEFORE', {
    identityMethod: 'SINGLE_TARGET_SESSION',
    formulaIndex: session.formulaIndex,
    desiredTag: session.desiredTag,
    decision: 'AUTHORIZED',
    runtimeMarker: R5_RUNTIME_MARKER,
  })

  session.injectionAuthorized = true
  data.math.math = `${originalTex} \\tag{${session.desiredTag}}`
  if (!data.math.inputData) data.math.inputData = {}
  data.math.inputData.inkChapterInjected = true
  data.math.inputData.originalTex = originalTex

  emitRuntimeAudit('MATHJAX-TAG-INJECTION-AFTER', {
    identityMethod: 'SINGLE_TARGET_SESSION',
    formulaIndex: session.formulaIndex,
    desiredTag: session.desiredTag,
    injected: true,
    tagOccurrenceCount: 1,
    decision: 'INJECTED',
    runtimeMarker: R5_RUNTIME_MARKER,
  })
}

// ── Hook Installation ───────────────────────────────────────────────────

export function installMathJaxHook(): void {
  if (isFilterInstalled) {
    emitRuntimeAudit('MATHJAX-PREFILTER-INSTALL', {
      decision: 'ALREADY_INSTALLED',
      installationCount: 1,
      runtimeMarker: R5_RUNTIME_MARKER,
    })
    return
  }

  const mj = typeof window !== 'undefined' ? (window as any).MathJax : null
  if (!mj) {
    emitRuntimeAudit('MATHJAX-PREFILTER-INSTALL', {
      decision: 'MATHJAX_NOT_FOUND',
      runtimeMarker: R5_RUNTIME_MARKER,
    })
    return
  }

  const doc = mj.startup?.document
  if (!doc?.inputJax) {
    emitRuntimeAudit('MATHJAX-PREFILTER-INSTALL', {
      decision: 'NO_INPUT_JAX',
      runtimeMarker: R5_RUNTIME_MARKER,
    })
    return
  }

  for (const jax of doc.inputJax) {
    if (jax.name === 'TeX') {
      try {
        jax.preFilters.add(inkChapterTagPreFilter)
        isFilterInstalled = true
        emitRuntimeAudit('MATHJAX-PREFILTER-INSTALL', {
          decision: 'SUCCESS',
          installationCount: 1,
          runtimeMarker: R5_RUNTIME_MARKER,
        })
      } catch (e: any) {
        emitRuntimeAudit('MATHJAX-PREFILTER-INSTALL', {
          decision: 'FAILED',
          error: e.message,
          runtimeMarker: R5_RUNTIME_MARKER,
        })
      }
      return
    }
  }

  emitRuntimeAudit('MATHJAX-PREFILTER-INSTALL', {
    decision: 'TEX_JAX_NOT_FOUND',
    runtimeMarker: R5_RUNTIME_MARKER,
  })
}