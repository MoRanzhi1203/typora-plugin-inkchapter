/**
 * TRAE V4 §9/§10/§11/§12/§24.2 — `SourceSyntaxDiagnosticPresentationAuthority`.
 *
 * The ONE presentation authority for the source-syntax family:
 *
 *   CODE_FENCE_UNCLOSED
 *   FORMULA_BLOCK_UNCLOSED
 *   FRONTMATTER_UNCLOSED
 *
 * It is deliberately SHARED — the three rules never grow three renderers. The
 * authority only DECLARES the contract (presentation kind, severity token,
 * minimum fragment count, the visual-commit predicate) so the host can reuse the
 * SINGLE existing inline-text carrier.
 *
 * The active visual contract (spec §10):
 *   - the EXISTING `error` severity token (never a new special red);
 *   - a low/medium emphasis error FILL + ONE left error ACCENT;
 *   - coverage = the opening token / opening source line ONLY — NEVER
 *     opener→EOF.
 *
 * Pure: no DOM, no host state.
 */

import type { SourceSyntaxKind, SourceSyntaxLocateDecision } from './document-diagnostic-source-syntax-location-authority'

/** §11 — the formal presentation-kind token of the source-syntax family. */
export const SOURCE_SYNTAX_PRESENTATION_KIND = 'source-syntax-error' as const

/** V5 §15 — the ONE active visual mode of the source-syntax family. */
export const SOURCE_SYNTAX_PRESENTATION_MODE = 'error-opener-fill-plus-accent' as const

/** §12 — a committed source-syntax visual needs at least ONE fragment. */
export const SOURCE_SYNTAX_MIN_VISUAL_FRAGMENT_COUNT = 1

/** §10 — the presentation consumes the EXISTING error severity token. */
export const SOURCE_SYNTAX_SEVERITY_TOKEN = 'error' as const

/** §10 — the ONE left accent is a surface style (never a border box). */
export const SOURCE_SYNTAX_LEFT_ACCENT = true as const

/** §24.2 — the source-syntax VISUAL runtime audit event. */
export const SOURCE_SYNTAX_VISUAL_AUDIT_EVENT = 'DOCUMENT-DIAGNOSTIC-SOURCE-SYNTAX-VISUAL-AUDIT'

export type SourceSyntaxTerminalState = 'COMMITTED' | 'FAILED'
export type SourceSyntaxCommitDecision = 'COMMIT' | 'NO_COMMIT'

/** §12/§13 — the facts a visual commit MUST prove. */
export interface SourceSyntaxVisualFacts {
  syntaxKind: SourceSyntaxKind
  /** V5 §14 — the diagnosticId is NEVER used as the ruleId. */
  diagnosticId?: string | null
  /** V5 §14 — the RULE id carried straight from the snapshot (never re-looked-up). */
  ruleId: string
  severity: 'error' | 'warning' | 'info'
  transactionId?: number | null
  sourceBlockIdentity?: string | null
  anchorResolved: boolean
  sourceRevisionCurrent: boolean
  carrierConnected: boolean
  visualFragmentCount: number
  paintedPrimaryRect: boolean
  accentPresent: boolean
  fillVisible: boolean
}

export interface SourceSyntaxVisualVerdict {
  commitDecision: SourceSyntaxCommitDecision
  terminalState: SourceSyntaxTerminalState
  reasons: string[]
}

/**
 * §12/§13/§14 — the ONE visual-commit predicate. A source-syntax activation may
 * only become ACTIVE when EVERY fact holds; any missing fact is an explicit
 * `NO_COMMIT` (never a silent partial paint, never a fake active row).
 */
export function evaluateSourceSyntaxVisualCommit(facts: SourceSyntaxVisualFacts): SourceSyntaxVisualVerdict {
  const reasons: string[] = []
  if (!facts.ruleId || facts.ruleId.trim() === '') reasons.push('RULE_ID_MISSING')
  if (facts.severity !== SOURCE_SYNTAX_SEVERITY_TOKEN) reasons.push('SEVERITY_NOT_ERROR')
  if (!facts.anchorResolved) reasons.push('ANCHOR_UNRESOLVED')
  if (!facts.sourceRevisionCurrent) reasons.push('SOURCE_REVISION_STALE')
  if (!facts.carrierConnected) reasons.push('CARRIER_DISCONNECTED')
  if (facts.visualFragmentCount < SOURCE_SYNTAX_MIN_VISUAL_FRAGMENT_COUNT) reasons.push('ZERO_PAINTED_FRAGMENT')
  if (!facts.paintedPrimaryRect) reasons.push('ZERO_PAINTED_RECT')
  if (!facts.accentPresent) reasons.push('MISSING_LEFT_ACCENT')
  if (!facts.fillVisible) reasons.push('MISSING_FILL')
  const commit = reasons.length === 0
  return {
    commitDecision: commit ? 'COMMIT' : 'NO_COMMIT',
    terminalState: commit ? 'COMMITTED' : 'FAILED',
    reasons,
  }
}

/** §18.2 — the source-syntax VISUAL audit payload. */
export function buildSourceSyntaxVisualAudit(
  facts: SourceSyntaxVisualFacts,
  verdict: SourceSyntaxVisualVerdict,
  diagnosticCode: string,
): Record<string, unknown> {
  return {
    transactionId: facts.transactionId ?? null,
    diagnosticId: facts.diagnosticId ?? null,
    diagnosticCode,
    ruleId: facts.ruleId,
    severity: facts.severity,
    presentationKind: SOURCE_SYNTAX_PRESENTATION_KIND,
    presentationMode: SOURCE_SYNTAX_PRESENTATION_MODE,
    syntaxKind: facts.syntaxKind,
    sourceBlockIdentity: facts.sourceBlockIdentity ?? null,
    carrierConnected: facts.carrierConnected,
    visualFragmentCount: facts.visualFragmentCount,
    paintedPrimaryRect: facts.paintedPrimaryRect,
    accentPresent: facts.accentPresent,
    fillVisible: facts.fillVisible,
    layoutEpochCurrent: facts.sourceRevisionCurrent,
    commitDecision: verdict.commitDecision,
    terminalState: verdict.terminalState,
    decision: verdict.commitDecision === 'COMMIT' ? 'PASS' : 'FAIL',
    reason: verdict.reasons.join(',') || 'SOURCE_SYNTAX_VISUAL_COMMITTED',
    reasons: verdict.reasons,
  }
}

/**
 * §13/§24.1 — the source-syntax LOCATE audit payload (the opener projection).
 */
export function buildSourceSyntaxLocateAudit(input: {
  documentKey: string | null
  diagnosticCode: string
  syntaxKind: SourceSyntaxKind
  sourceRevision: number | null
  sourceLine: number
  sourceRangeStart: number
  sourceRangeEnd: number
  openerIdentity: string
  resolveStrategy: string
  resolveDecision: SourceSyntaxLocateDecision
  resolvedTargetKind: string | null
  primaryElementKind: string | null
  domRangeResolved: boolean
  visibleRectCount: number
  layoutEpoch: number | null
}): Record<string, unknown> {
  return {
    documentKey: input.documentKey,
    diagnosticCode: input.diagnosticCode,
    syntaxKind: input.syntaxKind,
    sourceRevision: input.sourceRevision,
    sourceLine: input.sourceLine,
    sourceRangeStart: input.sourceRangeStart,
    sourceRangeEnd: input.sourceRangeEnd,
    openerIdentity: input.openerIdentity,
    resolveStrategy: input.resolveStrategy,
    resolveDecision: input.resolveDecision,
    resolvedTargetKind: input.resolvedTargetKind,
    primaryElementKind: input.primaryElementKind,
    domRangeResolved: input.domRangeResolved,
    visibleRectCount: input.visibleRectCount,
    layoutEpoch: input.layoutEpoch,
  }
}
