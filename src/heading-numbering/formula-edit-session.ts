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

export const R5438_RUNTIME_MARKER = 'FORMULA-STRUCTURAL-SLOT-EDIT-SESSION-PROJECTION-V2.5.7-R5.4.3.8'
export const R5438_BUILD_MARKER = 'inkchapter-formula-structural-slot-edit-session-projection-v2.5.7-r5.4.3.8'

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
    runtimeMarker: R5438_RUNTIME_MARKER,
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
    runtimeMarker: R5438_RUNTIME_MARKER,
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
    runtimeMarker: R5438_RUNTIME_MARKER,
  })
}

// ── Formula Edit Session ──────────────────────────────────────────────────

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
    runtimeMarker: R5438_RUNTIME_MARKER,
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
      runtimeMarker: R5438_RUNTIME_MARKER,
    })
  }
  activeSession = null
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
    runtimeMarker: R5438_RUNTIME_MARKER,
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
    runtimeMarker: R5438_RUNTIME_MARKER,
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
    runtimeMarker: R5438_RUNTIME_MARKER,
  })
}

export function resetEditSessionState(): void {
  activeSession = null
  sessionSeq = 0
}
