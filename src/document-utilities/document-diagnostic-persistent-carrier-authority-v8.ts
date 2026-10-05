/**
 * TRAE rebase — Diagnostic Click Provenance (generic audit).
 *
 * HISTORY: this module also hosted the V6/V7/V8 `CODE_EMPTY_BLOCK` special
 * presentation lifecycle (empty-container surface / persistent carrier / atomic
 * handoff / compositing / final-visual-commit). That whole lifecycle was REMOVED
 * from production: `CODE_EMPTY_BLOCK` is a canonical `block:code:N` code
 * diagnostic and is presented by the SAME generic LocateFrame / overlay-frame /
 * document-space carrier pipeline as `CODE_MISSING_NAME` and
 * `CODE_MISSING_LANGUAGE`.
 *
 * What remains is the ONE capability that is genuinely GENERIC and rule-agnostic:
 * the click provenance audit. It is a SIDE-CHANNEL audit — it never gates the
 * creation of any carrier.
 *
 *   §5 — ONE trusted physical pointer activation → exactly ONE business
 *        CLICK_DISPATCH. A duplicate dispatch of the SAME activation must be
 *        DROPPED; a genuine second click (its own `pointerdown`) mints a NEW
 *        token and keeps its normal toggle semantics.
 *
 * Pure: no DOM, no host state.
 */

export const CLICK_PROVENANCE_AUDIT_EVENT = 'DOCUMENT-DIAGNOSTIC-CLICK-PROVENANCE-AUDIT'

export type ClickProvenanceDecision =
  | 'DISPATCH'
  | 'DROP_DUPLICATE_POINTER_ACTIVATION'

export interface PointerActivationToken {
  /** Monotonic id of the physical activation. */
  pointerActivationId: number
  /** How the token was minted. */
  source: 'POINTER_DOWN' | 'KEYBOARD' | 'IMPLICIT_CLICK'
  pointerId: number | null
  pointerType: string | null
  button: number | null
  timeStamp: number
  targetIdentity: string
  /** Business dispatches already charged to THIS activation. */
  dispatchCount: number
}

export interface ClickProvenanceInput {
  /** The pending activation token (null when the click had no pointerdown). */
  token: PointerActivationToken | null
  eventType: string
  eventIsTrusted: boolean
  eventTimeStamp: number
  eventDetail: number
  button: number | null
  buttons: number | null
  pointerId: number | null
  pointerType: string | null
  eventTargetIdentity: string
  currentTargetIdentity: string
  listenerGeneration: number
  handlerInstanceId: string
}

export interface ClickProvenanceVerdict {
  dispatch: boolean
  decision: ClickProvenanceDecision
  reason: string
  /** The token this decision is charged to (null when none existed). */
  chargedToken: PointerActivationToken | null
}

/**
 * The ONE click provenance rule.
 *
 *   - a token minted by a REAL `pointerdown` that has ALREADY charged one business
 *     dispatch can never charge a second one → DROP.
 *   - a click with NO token (synthetic / keyboard-driven) is allowed and charged to
 *     `null` — the authority must never invent a duplicate-activation drop out of
 *     nothing (that would silently break a genuine second click in environments
 *     that do not emit pointerdown).
 *   - a NEW pointerdown always mints a NEW token, so a genuine second user click
 *     keeps producing the normal same-target toggle.
 */
export function evaluateClickProvenance(input: ClickProvenanceInput): ClickProvenanceVerdict {
  const token = input.token
  if (token != null && token.source === 'POINTER_DOWN' && token.dispatchCount >= 1) {
    return {
      dispatch: false,
      decision: 'DROP_DUPLICATE_POINTER_ACTIVATION',
      reason: 'DUPLICATE_BUSINESS_CLICK_FOR_POINTER_ACTIVATION',
      chargedToken: token,
    }
  }
  return {
    dispatch: true,
    decision: 'DISPATCH',
    reason: token == null ? 'NO_POINTER_ACTIVATION_TOKEN' : `ACTIVATION_${token.source}_FIRST_DISPATCH`,
    chargedToken: token,
  }
}

/** The full click provenance audit row (never a partial record). */
export function buildClickProvenanceAudit(input: {
  documentKey: string | null
  diagnosticId: string | null
  targetKey: string | null
  provenance: ClickProvenanceInput
  businessClickSequence: number
  businessDispatchCountForPointerActivation: number
  classifiedAction: string | null
  sameDiagnostic: boolean
  sameTarget: boolean
  verdict: ClickProvenanceVerdict
}): Record<string, unknown> {
  const p = input.provenance
  return {
    documentKey: input.documentKey,
    diagnosticId: input.diagnosticId,
    targetKey: input.targetKey,
    pointerActivationId: p.token?.pointerActivationId ?? null,
    pointerActivationSource: p.token?.source ?? null,
    eventType: p.eventType,
    eventIsTrusted: p.eventIsTrusted,
    eventTimeStamp: p.eventTimeStamp,
    eventDetail: p.eventDetail,
    button: p.button,
    buttons: p.buttons,
    pointerId: p.pointerId,
    pointerType: p.pointerType,
    eventTargetIdentity: p.eventTargetIdentity,
    currentTargetIdentity: p.currentTargetIdentity,
    listenerGeneration: p.listenerGeneration,
    handlerInstanceId: p.handlerInstanceId,
    businessClickSequence: input.businessClickSequence,
    businessDispatchCountForPointerActivation: input.businessDispatchCountForPointerActivation,
    classifiedAction: input.classifiedAction,
    sameDiagnostic: input.sameDiagnostic,
    sameTarget: input.sameTarget,
    decision: input.verdict.decision,
    reason: input.verdict.reason,
  }
}
