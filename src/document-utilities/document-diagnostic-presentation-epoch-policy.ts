/**
 * TRAE rebase — Diagnostic presentation EPOCH audit + FILL_ONLY ownership policy.
 *
 * These are the only two capabilities that survived the `CODE_EMPTY_BLOCK`
 * generic-pipeline rebase from the former V7 "empty-block surface" contract:
 *
 *   §6.4 — `DOCUMENT-DIAGNOSTIC-PRESENTATION-EPOCH-AUDIT`: a plugin's OWN
 *          presentation mutation must never invalidate the visual it just
 *          mounted.
 *   §7.2 — FILL_ONLY only constrains PLUGIN-OWNED decoration; a Typora native
 *          code block border is a host fact and must never FAIL the gate (and
 *          must never be deleted to make the gate pass).
 *
 * Both are RULE-AGNOSTIC. The V6/V7/V8 empty-container surface / persistent
 * carrier / handoff / compositing / final-visual-commit lifecycle was REMOVED
 * from production together with the special empty-block visual entry;
 * `CODE_EMPTY_BLOCK` is now a plain canonical code diagnostic presented by the
 * generic LocateFrame.
 *
 * Pure: no DOM, no host state.
 */

/** §6.4 — the presentation-epoch (mutation provenance) audit event. */
export const PRESENTATION_EPOCH_AUDIT_EVENT = 'DOCUMENT-DIAGNOSTIC-PRESENTATION-EPOCH-AUDIT'

/**
 * §6.2 — the mutation provenance vocabulary. Only `PLUGIN_PRESENTATION_MUTATION`
 * may be short-circuited; the others still invalidate geometry / refresh
 * diagnostics.
 */
export type PresentationMutationProvenance =
  | 'USER_CONTENT_MUTATION'
  | 'HOST_LAYOUT_MUTATION'
  | 'PLUGIN_PRESENTATION_MUTATION'

/** §6.2 — may this provenance invalidate the CURRENT visual geometry? */
export function provenanceInvalidatesVisual(p: PresentationMutationProvenance): boolean {
  return p !== 'PLUGIN_PRESENTATION_MUTATION'
}

export interface PresentationEpochAuditInput {
  documentKey: string | null
  mutationProvenance: PresentationMutationProvenance
  presentationOwnerVersion: number
  transactionId: number | null
  diagnosticId: string | null
  layoutEpochBefore: number
  layoutEpochAfter: number
  semanticRevisionBefore: number | null
  semanticRevisionAfter: number | null
  currentVisualInvalidated: boolean
  invalidationReason: string
}

export function buildPresentationEpochAudit(
  input: PresentationEpochAuditInput,
): Record<string, unknown> {
  const layoutEpochChanged = input.layoutEpochBefore !== input.layoutEpochAfter
  const semanticRevisionChanged = input.semanticRevisionBefore !== input.semanticRevisionAfter
  return {
    ...input,
    /** §6.2 — a plugin presentation mutation must never invalidate its own visual. */
    semanticReconcileAllowed: input.mutationProvenance !== 'PLUGIN_PRESENTATION_MUTATION',
    layoutEpochChanged,
    semanticRevisionChanged,
    presentationMutationSelfInvalidation:
      input.mutationProvenance === 'PLUGIN_PRESENTATION_MUTATION' && input.currentVisualInvalidated,
    decision: input.mutationProvenance === 'PLUGIN_PRESENTATION_MUTATION' && input.currentVisualInvalidated
      ? 'FAIL'
      : 'PASS',
  }
}

// ── §7.2 — the layered FILL_ONLY ownership facts ──────────────────────────────

export interface FillOnlyOwnershipFacts {
  pluginOwnedFillCount: number
  pluginOwnedBorderCount: number
  pluginOwnedOutlineCount: number
  pluginOwnedVerticalLineCount: number
  pluginOwnedHorizontalLineCount: number
  pluginOwnedKeylineCount: number
  pluginOwnedCornerArmCount: number
  pluginOwnedShadowCount: number
  hostNativeBorderCount: number
  hostNativeOutlineCount: number
}

export function emptyFillOnlyOwnershipFacts(): FillOnlyOwnershipFacts {
  return {
    pluginOwnedFillCount: 0,
    pluginOwnedBorderCount: 0,
    pluginOwnedOutlineCount: 0,
    pluginOwnedVerticalLineCount: 0,
    pluginOwnedHorizontalLineCount: 0,
    pluginOwnedKeylineCount: 0,
    pluginOwnedCornerArmCount: 0,
    pluginOwnedShadowCount: 0,
    hostNativeBorderCount: 0,
    hostNativeOutlineCount: 0,
  }
}

/**
 * §7.2 — FILL_ONLY only FAILS on PLUGIN-OWNED decoration. A host-native border
 * (the Typora code block border) is recorded but never fatal.
 */
export function evaluateFillOnlyOwnershipGate(
  facts: FillOnlyOwnershipFacts,
  committed: boolean,
): { decision: 'PASS' | 'FAIL'; failing: string[] } {
  if (!committed) return { decision: 'PASS', failing: [] }
  const failing: string[] = []
  if (facts.pluginOwnedFillCount < 1) failing.push('PLUGIN_OWNED_FILL_MISSING')
  if (facts.pluginOwnedBorderCount > 0) failing.push('PLUGIN_OWNED_BORDER_COUNT')
  if (facts.pluginOwnedOutlineCount > 0) failing.push('PLUGIN_OWNED_OUTLINE_COUNT')
  if (facts.pluginOwnedVerticalLineCount > 0) failing.push('PLUGIN_OWNED_RAIL_COUNT')
  if (facts.pluginOwnedHorizontalLineCount > 0) failing.push('PLUGIN_OWNED_HORIZONTAL_LINE_COUNT')
  if (facts.pluginOwnedKeylineCount > 0) failing.push('PLUGIN_OWNED_KEYLINE_COUNT')
  if (facts.pluginOwnedCornerArmCount > 0) failing.push('PLUGIN_OWNED_CORNER_ARM_COUNT')
  if (facts.pluginOwnedShadowCount > 0) failing.push('PLUGIN_OWNED_SHADOW_COUNT')
  return { decision: failing.length === 0 ? 'PASS' : 'FAIL', failing }
}
