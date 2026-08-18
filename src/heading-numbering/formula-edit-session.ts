/**
 * v2.5.7-R5.4.3.8: Formula Edit Session Identity / Source Commit Barrier.
 *
 * Click / focus / startEditing / CodeMirror-mount / rawblock-mount / MJX
 * replacement are NONSEMANTIC EDIT TRANSITIONS — they NEVER commit source.
 * Only explicit input evidence (beforeinput/input/CodeMirror semantic change)
 * associated with the SAME edit session may advance contentRevision.
 *
 * The edit-session latched stableFormulaIdentity outranks DOM-based
 * currentEditingFormulaCandidateCount and source-hash uniqueness.
 */

import { emitRuntimeAudit } from '../runtime/forensic-log-sink'
import { tokenFor } from './mathjax-native-tag-injection'

export const R5439_RUNTIME_MARKER = 'FORMULA-ATOMIC-TRANSACTION-RENDER-PROJECTION-V2.5.7-R5.4.3.9'
export const R5439_BUILD_MARKER = 'inkchapter-formula-atomic-transaction-render-projection-v2.5.7-r5.4.3.9'

// ── Structural Formula Slot ───────────────────────────────────────────────

export interface FormulaStructuralSlot {
  stableFormulaIdentity: number | 'AMBIGUOUS' | null
  formulaIndex: number | null
  hostToken: number
  sourceState: 'EMPTY' | 'NONEMPTY'
  rawTexLength: number
  desiredTag: string | null
  managedForNumbering: boolean
}

export function emitStructuralSlotAuthority(input: {
  documentKey: string
  generation: number
  rootToken: number
  hostToken: number
  stableFormulaIdentity: number | 'AMBIGUOUS' | null
  formulaIndex: number | null
  sourceState: 'EMPTY' | 'NONEMPTY'
  rawTexLength: number
  managedForNumbering: boolean
  scopeKey: string | null
  sequenceValue: number | null
  desiredTag: string | null
}): void {
  const pass = input.managedForNumbering
    && input.stableFormulaIdentity !== null && input.stableFormulaIdentity !== 'AMBIGUOUS'
    && input.formulaIndex !== null
    && input.desiredTag !== null && input.desiredTag !== ''
  emitRuntimeAudit('FORMULA-STRUCTURAL-SLOT-AUTHORITY', {
    documentKey: input.documentKey,
    generation: input.generation,
    rootToken: input.rootToken,
    hostToken: input.hostToken,
    stableFormulaIdentity: input.stableFormulaIdentity ?? null,
    formulaIndex: input.formulaIndex ?? null,
    sourceState: input.sourceState,
    rawTexLength: input.rawTexLength,
    managedForNumbering: input.managedForNumbering,
    scopeKey: input.scopeKey,
    sequenceValue: input.sequenceValue,
    desiredTag: input.desiredTag,
    decision: pass ? 'PASS' : 'FAIL',
    reason: pass ? null : 'STRUCTURAL_SLOT_INCOMPLETE',
    runtimeMarker: R5439_RUNTIME_MARKER,
  })
}

export function emitEmptySourceManagedSlot(input: {
  documentKey: string
  generation: number
  rootToken: number
  hostToken: number
  stableFormulaIdentity: number | 'AMBIGUOUS' | null
  formulaIndex: number | null
  scopeKey: string | null
  sequenceValue: number | null
  desiredTag: string | null
}): void {
  const pass = input.stableFormulaIdentity !== null
    && input.stableFormulaIdentity !== 'AMBIGUOUS'
    && input.formulaIndex !== null
    && input.desiredTag !== null && input.desiredTag !== ''
  emitRuntimeAudit('FORMULA-EMPTY-SOURCE-MANAGED-SLOT', {
    documentKey: input.documentKey,
    generation: input.generation,
    rootToken: input.rootToken,
    hostToken: input.hostToken,
    stableFormulaIdentity: input.stableFormulaIdentity ?? null,
    formulaIndex: input.formulaIndex ?? null,
    sourceState: 'EMPTY',
    rawTexLength: 0,
    managedForNumbering: true,
    scopeKey: input.scopeKey,
    sequenceValue: input.sequenceValue,
    desiredTag: input.desiredTag,
    decision: pass ? 'PASS' : 'FAIL',
    reason: pass ? null : 'EMPTY_SLOT_INCOMPLETE',
    runtimeMarker: R5439_RUNTIME_MARKER,
  })
}

export const EMPTY_FORMULA_SENTINEL = '<Empty \\space Math \\space Block>'

export function isEmptyFormulaSentinel(tex: string): boolean {
  const t = tex.trim()
  return t === '' || t === EMPTY_FORMULA_SENTINEL || t === '\\space' || /^\\space(\s|$)/.test(t)
}

export function emitEmptyTex2svgSentinelAuthority(input: {
  callOrdinal: number
  documentKey: string
  generation: number
  rootToken: number
  stableFormulaIdentity: number | 'AMBIGUOUS' | null
  formulaIndex: number | null
  desiredTag: string | null
  authorizedBy: 'HOST_IDENTITY' | 'EDIT_SESSION' | 'SOURCE_MATCH' | 'NONE'
  decision: 'AUTHORIZED_EMPTY_FORMULA_SLOT' | 'FAIL'
  reason: string | null
}): void {
  emitRuntimeAudit('FORMULA-EMPTY-TEX2SVG-SENTINEL-AUTHORITY', {
    callOrdinal: input.callOrdinal,
    documentKey: input.documentKey,
    generation: input.generation,
    rootToken: input.rootToken,
    stableFormulaIdentity: input.stableFormulaIdentity ?? null,
    formulaIndex: input.formulaIndex ?? null,
    desiredTag: input.desiredTag,
    authorizedBy: input.authorizedBy,
    decision: input.decision,
    reason: input.reason,
    runtimeMarker: R5439_RUNTIME_MARKER,
  })
}

// ── Formula Edit Session ──────────────────────────────────────────────────

export type FormulaEditSessionStatus = 'ACTIVE' | 'SUPERSEDED'

export interface FormulaEditSession {
  sessionId: string
  documentKey: string
  generation: number
  rootToken: number
  stableFormulaIdentity: number | 'AMBIGUOUS'
  formulaHostToken: number
  formulaIndex: number | null
  desiredTag: string | null
  sourceHashAtEnter: string | null
  contentRevisionAtEnter: number
  explicitInputObserved: boolean
  status: FormulaEditSessionStatus
}

let activeSession: FormulaEditSession | null = null
let sessionSeq = 0

export function latchEditSession(input: {
  documentKey: string
  generation: number
  rootToken: number
  stableFormulaIdentity: number | 'AMBIGUOUS'
  formulaHostToken: number
  formulaIndex: number | null
  desiredTag: string | null
  sourceHashAtEnter: string | null
  contentRevisionAtEnter: number
  trigger: string
}): FormulaEditSession {
  const session: FormulaEditSession = {
    sessionId: `es-${++sessionSeq}`,
    documentKey: input.documentKey,
    generation: input.generation,
    rootToken: input.rootToken,
    stableFormulaIdentity: input.stableFormulaIdentity,
    formulaHostToken: input.formulaHostToken,
    formulaIndex: input.formulaIndex,
    desiredTag: input.desiredTag,
    sourceHashAtEnter: input.sourceHashAtEnter,
    contentRevisionAtEnter: input.contentRevisionAtEnter,
    explicitInputObserved: false,
    status: 'ACTIVE',
  }
  activeSession = session
  emitRuntimeAudit('FORMULA-EDIT-SESSION-IDENTITY-LATCH', {
    sessionId: session.sessionId,
    documentKey: input.documentKey,
    generation: input.generation,
    rootToken: input.rootToken,
    stableFormulaIdentity: input.stableFormulaIdentity ?? null,
    formulaIndex: input.formulaIndex ?? null,
    desiredTag: input.desiredTag,
    trigger: input.trigger,
    decision: 'LATCHED',
    runtimeMarker: R5439_RUNTIME_MARKER,
  })
  return session
}

export function getActiveEditSession(): FormulaEditSession | null {
  return activeSession
}

export function clearEditSession(reason: string): void {
  if (activeSession) {
    emitRuntimeAudit('FORMULA-EDIT-SESSION-IDENTITY-LATCH', {
      sessionId: activeSession.sessionId,
      documentKey: activeSession.documentKey,
      generation: activeSession.generation,
      rootToken: activeSession.rootToken,
      stableFormulaIdentity: activeSession.stableFormulaIdentity ?? null,
      formulaIndex: activeSession.formulaIndex ?? null,
      desiredTag: activeSession.desiredTag,
      trigger: 'clear',
      decision: 'CLEARED',
      reason,
      runtimeMarker: R5439_RUNTIME_MARKER,
    })
  }
  activeSession = null
  currentTransaction = null
}

export function emitNonsemanticEditTransition(input: {
  sessionId: string | null
  eventKind: string
  stableFormulaIdentity: number | 'AMBIGUOUS' | null
  formulaIndex: number | null
  userSemanticSourceChange: boolean
}): void {
  emitRuntimeAudit('FORMULA-EDIT-SESSION-NONSEMANTIC-TRANSITION', {
    sessionId: input.sessionId,
    eventKind: input.eventKind,
    stableFormulaIdentity: input.stableFormulaIdentity ?? null,
    formulaIndex: input.formulaIndex ?? null,
    userSemanticSourceChange: input.userSemanticSourceChange,
    decision: 'NONSEMANTIC',
    runtimeMarker: R5439_RUNTIME_MARKER,
  })
}

export interface SourceCommitBarrierInput {
  sessionId: string | null
  stableFormulaIdentity: number | 'AMBIGUOUS' | null
  formulaIndex: number | null
  eventKind: string
  explicitInputObserved: boolean
  sourceHashBefore: string | null
  candidateSourceHash: string | null
  contentRevisionBefore: number
}

export interface SourceCommitBarrierResult {
  commitAllowed: boolean
  sourceHashAfter: string | null
  contentRevisionAfter: number
  decision: 'COMMIT' | 'BLOCK_NON_INPUT_EDIT_STATE_DRIFT'
  reason: string | null
}

/**
 * The authoritative source-commit gate. Only explicit input evidence within a
 * latched edit session may advance source hash / contentRevision.
 */
export function checkSourceCommitBarrier(input: SourceCommitBarrierInput): SourceCommitBarrierResult {
  const commitAllowed = input.explicitInputObserved
  const result: SourceCommitBarrierResult = {
    commitAllowed,
    sourceHashAfter: commitAllowed ? input.candidateSourceHash : input.sourceHashBefore,
    contentRevisionAfter: commitAllowed ? input.contentRevisionBefore + 1 : input.contentRevisionBefore,
    decision: commitAllowed ? 'COMMIT' : 'BLOCK_NON_INPUT_EDIT_STATE_DRIFT',
    reason: commitAllowed ? null : 'NON_INPUT_EDIT_STATE_DRIFT_BLOCKED',
  }
  emitRuntimeAudit('FORMULA-EDIT-SESSION-SOURCE-COMMIT-BARRIER', {
    editSessionId: input.sessionId,
    stableFormulaIdentity: input.stableFormulaIdentity ?? null,
    formulaIndex: input.formulaIndex ?? null,
    eventKind: input.eventKind,
    explicitInputObserved: input.explicitInputObserved,
    sourceHashBefore: input.sourceHashBefore,
    candidateSourceHash: input.candidateSourceHash,
    sourceHashAfter: result.sourceHashAfter,
    contentRevisionBefore: input.contentRevisionBefore,
    contentRevisionAfter: result.contentRevisionAfter,
    commitAllowed: result.commitAllowed,
    decision: result.decision,
    reason: result.reason,
    runtimeMarker: R5439_RUNTIME_MARKER,
  })
  return result
}

export function markSessionExplicitInput(session: FormulaEditSession): void {
  session.explicitInputObserved = true
}

export function emitEditSessionTex2svgAuthority(input: {
  callOrdinal: number
  sessionId: string | null
  stableFormulaIdentity: number | 'AMBIGUOUS' | null
  formulaIndex: number | null
  desiredTag: string | null
  currentEditingCandidateCount: number
  authorizedBy: 'EDIT_SESSION_LATCH' | 'HOST_IDENTITY' | 'SOURCE_MATCH' | 'NONE'
  authorized: boolean
}): void {
  emitRuntimeAudit('FORMULA-EDIT-SESSION-TEX2SVG-AUTHORITY', {
    callOrdinal: input.callOrdinal,
    sessionId: input.sessionId,
    stableFormulaIdentity: input.stableFormulaIdentity ?? null,
    formulaIndex: input.formulaIndex ?? null,
    desiredTag: input.desiredTag,
    currentEditingCandidateCount: input.currentEditingCandidateCount,
    authorizedBy: input.authorizedBy,
    authorized: input.authorized,
    decision: input.authorized ? 'AUTHORIZED' : 'FAIL',
    reason: input.authorized ? null : 'EDIT_SESSION_AUTHORIZATION_FAILED',
    runtimeMarker: R5439_RUNTIME_MARKER,
  })
}

export function resetEditSessionState(): void {
  activeSession = null
  sessionSeq = 0
  currentTransaction = null
  transactionSeq = 0
}

// ── Current Formula Transaction ───────────────────────────────────────────

export interface CurrentFormulaTransaction {
  transactionId: string
  documentKey: string
  documentGeneration: number
  editorRootToken: number
  formulaHost: HTMLElement | null
  formulaHostToken: number
  stableFormulaIdentity: number
  formulaIndex: number
  planRevision: number
  liveFormulaRevision: number
  desiredTag: string
  rawTex: string
  sourceState: 'EMPTY' | 'NONEMPTY'
  planEntryIdentity: string
  createdBy: 'CURRENT_HOST' | 'EDIT_SESSION' | 'CALLER_CONTEXT' | 'SOURCE_MATCH'
}

let currentTransaction: CurrentFormulaTransaction | null = null
let transactionSeq = 0

export function latchOrRebindCurrentFormulaTransaction(input: {
  documentKey: string
  documentGeneration: number
  editorRootToken: number
  formulaHost: HTMLElement | null
  stableFormulaIdentity: number
  formulaIndex: number
  planRevision: number
  liveFormulaRevision: number
  desiredTag: string
  rawTex: string
  sourceState: 'EMPTY' | 'NONEMPTY'
  createdBy: 'CURRENT_HOST' | 'EDIT_SESSION' | 'CALLER_CONTEXT' | 'SOURCE_MATCH'
  previousSessionId?: string | null
}): CurrentFormulaTransaction {
  // ── Supersede previous session if host changed ─────────────────────────
  if (activeSession && input.formulaHost !== null && activeSession.formulaHostToken !== tokenFor(input.formulaHost)) {
    activeSession.status = 'SUPERSEDED'
    const oldSessionId = activeSession.sessionId
    const newSessionId = `es-${sessionSeq + 1}`
    emitRuntimeAudit('FORMULA-EDIT-SESSION-HANDOFF', {
      oldSessionId,
      newSessionId,
      currentCallConsumesSessionId: newSessionId,
      runtimeMarker: R5439_RUNTIME_MARKER,
    })
  }

  // ── Latch new session ──────────────────────────────────────────────────
  const hostToken = input.formulaHost ? tokenFor(input.formulaHost) : 0
  const session = latchEditSession({
    documentKey: input.documentKey,
    generation: input.documentGeneration,
    rootToken: input.editorRootToken,
    stableFormulaIdentity: input.stableFormulaIdentity,
    formulaHostToken: hostToken,
    formulaIndex: input.formulaIndex,
    desiredTag: input.desiredTag,
    sourceHashAtEnter: null,
    contentRevisionAtEnter: 0,
    trigger: 'latchOrRebindCurrentFormulaTransaction',
  })

  // ── Create transaction ─────────────────────────────────────────────────
  const transactionId = `tx-${++transactionSeq}`
  const planEntryIdentity = `${input.stableFormulaIdentity}|${input.formulaIndex}|${input.planRevision}`
  const transaction: CurrentFormulaTransaction = {
    transactionId,
    documentKey: input.documentKey,
    documentGeneration: input.documentGeneration,
    editorRootToken: input.editorRootToken,
    formulaHost: input.formulaHost,
    formulaHostToken: hostToken,
    stableFormulaIdentity: input.stableFormulaIdentity,
    formulaIndex: input.formulaIndex,
    planRevision: input.planRevision,
    liveFormulaRevision: input.liveFormulaRevision,
    desiredTag: input.desiredTag,
    rawTex: input.rawTex,
    sourceState: input.sourceState,
    planEntryIdentity,
    createdBy: input.createdBy,
  }
  currentTransaction = transaction

  // ── Emit FORMULA-CURRENT-TRANSACTION-AUTHORITY ─────────────────────────
  emitRuntimeAudit('FORMULA-CURRENT-TRANSACTION-AUTHORITY', {
    transactionId: transaction.transactionId,
    documentKey: transaction.documentKey,
    documentGeneration: transaction.documentGeneration,
    editorRootToken: transaction.editorRootToken,
    formulaHostToken: transaction.formulaHostToken,
    stableFormulaIdentity: transaction.stableFormulaIdentity,
    formulaIndex: transaction.formulaIndex,
    planRevision: transaction.planRevision,
    liveFormulaRevision: transaction.liveFormulaRevision,
    desiredTag: transaction.desiredTag,
    rawTex: transaction.rawTex,
    sourceState: transaction.sourceState,
    planEntryIdentity: transaction.planEntryIdentity,
    createdBy: transaction.createdBy,
    sessionId: session.sessionId,
    runtimeMarker: R5439_RUNTIME_MARKER,
  })

  // ── Emit FORMULA-TRANSACTION-INDEX-CONSISTENCY ─────────────────────────
  const hostResolvedFormulaIndex = input.formulaIndex
  const planEntryFormulaIndex = input.formulaIndex
  const sessionFormulaIndex = session.formulaIndex
  const transactionFormulaIndex = transaction.formulaIndex
  const allConsistent = hostResolvedFormulaIndex === planEntryFormulaIndex
    && planEntryFormulaIndex === sessionFormulaIndex
    && sessionFormulaIndex === transactionFormulaIndex
  emitRuntimeAudit('FORMULA-TRANSACTION-INDEX-CONSISTENCY', {
    hostResolvedFormulaIndex,
    planEntryFormulaIndex,
    sessionFormulaIndex,
    transactionFormulaIndex,
    decision: allConsistent ? 'PASS' : 'FAIL',
    reason: allConsistent ? null : 'FORMULA_INDEX_MISMATCH',
    runtimeMarker: R5439_RUNTIME_MARKER,
  })

  return transaction
}

export function getCurrentTransaction(): CurrentFormulaTransaction | null {
  return currentTransaction
}

export function clearCurrentTransaction(reason: string): void {
  if (currentTransaction) {
    emitRuntimeAudit('FORMULA-CURRENT-TRANSACTION-AUTHORITY', {
      transactionId: currentTransaction.transactionId,
      documentKey: currentTransaction.documentKey,
      documentGeneration: currentTransaction.documentGeneration,
      editorRootToken: currentTransaction.editorRootToken,
      formulaHostToken: currentTransaction.formulaHostToken,
      stableFormulaIdentity: currentTransaction.stableFormulaIdentity,
      formulaIndex: currentTransaction.formulaIndex,
      planRevision: currentTransaction.planRevision,
      liveFormulaRevision: currentTransaction.liveFormulaRevision,
      desiredTag: currentTransaction.desiredTag,
      rawTex: currentTransaction.rawTex,
      sourceState: currentTransaction.sourceState,
      planEntryIdentity: currentTransaction.planEntryIdentity,
      createdBy: currentTransaction.createdBy,
      sessionId: null,
      decision: 'CLEARED',
      reason,
      runtimeMarker: R5439_RUNTIME_MARKER,
    })
  }
  currentTransaction = null
}

export function resetTransactionState(): void {
  currentTransaction = null
  transactionSeq = 0
}

export function emitTransactionPlanRebind(input: {
  oldPlanRevision: number
  newPlanRevision: number
  stableFormulaIdentity: number
  oldFormulaIndex: number | null
  newFormulaIndex: number
  oldDesiredTag: string | null
  newDesiredTag: string
  sameIdentity: boolean
  decision: 'PASS' | 'FAIL'
  reason: string | null
}): void {
  emitRuntimeAudit('FORMULA-CURRENT-TRANSACTION-PLAN-REBIND', {
    oldPlanRevision: input.oldPlanRevision,
    newPlanRevision: input.newPlanRevision,
    stableFormulaIdentity: input.stableFormulaIdentity,
    oldFormulaIndex: input.oldFormulaIndex,
    newFormulaIndex: input.newFormulaIndex,
    oldDesiredTag: input.oldDesiredTag,
    newDesiredTag: input.newDesiredTag,
    sameIdentity: input.sameIdentity,
    decision: input.decision,
    reason: input.reason,
    runtimeMarker: R5439_RUNTIME_MARKER,
  })
}
