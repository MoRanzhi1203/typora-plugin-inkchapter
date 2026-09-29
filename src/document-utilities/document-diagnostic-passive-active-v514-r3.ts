/**
 * V5.14-R3 — Diagnostic PASSIVE / ACTIVE decoupling + heading-content live-edit
 * invalidation + Active high-contrast colour scale.
 *
 * ROOT_P10_R3_1 = the ACTIVE locate path left the non-selected PASSIVE markers
 *   invisible: a re-created document/heading layer ORPHANED every passive
 *   wrapper while `headingPassiveMarkers` kept the records, so the next render
 *   reused the detached node and never re-attached it — the user saw only the
 *   freshly created ACTIVE node.
 * ROOT_P10_R3_2/R3_3 = the passive set was conceptually coupled to the selected
 *   diagnostic / active target instead of being the document's own authority.
 * ROOT_P10_R3_4 = the active emphasis REMOVED the active heading's own passive
 *   fill (R9 suspension), so even the selected heading lost its passive state.
 *
 * ROOT_P11_R3_1..R3_6 = `stableHeadingIdentity` was treated as geometry
 *   stability: there was NO content fingerprint in the visual state, so a heading
 *   text edit (same identity, same diagnostic) left the old PASSIVE fill width,
 *   the old ACTIVE width and the old reason-chip anchor in place.
 *
 * ROOT_P12_R3_1 = the ACTIVE fill reused the PASSIVE severity tokens with an even
 *   LOWER alpha (0.07 active vs 0.09/0.10 passive), so "active" was visually
 *   weaker than "passive" (ratio 0.78, far below the required 2.4).
 *
 * Pure contract: no DOM, no host state.
 */

import type { DiagnosticVisualTargetKey } from './document-diagnostic-visual-closure-target-v514-r2'

// ── §2 — the two INDEPENDENT authorities ───────────────────────────────────

export interface PassiveDiagnosticVisualState {
  documentKey: string
  revision: number
  /** EVERY currently valid target projection — never reduced to the selection. */
  targets: ReadonlyMap<DiagnosticVisualTargetKey, PassiveTargetFact>
}

export interface PassiveTargetFact {
  visualTargetKey: DiagnosticVisualTargetKey
  stableHeadingIdentity: string
  severity: string
}

export interface ActiveDiagnosticEmphasisState {
  documentKey: string
  selectedDiagnosticId: string | null
  selectedTargetIndex: number | null
  activeVisualTargetKey: DiagnosticVisualTargetKey | null
}

/**
 * §4 — the ACTIVE target is ALWAYS one of the PASSIVE targets. An active key
 * outside the passive set is the P10 violation (active replaced the set).
 */
export function activeTargetBelongsToPassiveSet(
  passive: PassiveDiagnosticVisualState,
  active: ActiveDiagnosticEmphasisState,
): boolean {
  if (active.activeVisualTargetKey == null) return true
  return passive.targets.has(active.activeVisualTargetKey)
}

export function passiveVisualTargetKeys(passive: PassiveDiagnosticVisualState): DiagnosticVisualTargetKey[] {
  return [...passive.targets.keys()]
}

/**
 * §3 — reconcile the PASSIVE set. Input: the previous passive keys and the
 * required ones. Output: what to add / remove. An ACTIVE change can never appear
 * here because the active state is not an argument.
 */
export function reconcilePassiveDiagnosticMarkers(input: {
  previousKeys: readonly DiagnosticVisualTargetKey[]
  requiredKeys: readonly DiagnosticVisualTargetKey[]
}): { added: DiagnosticVisualTargetKey[]; removed: DiagnosticVisualTargetKey[]; unchanged: DiagnosticVisualTargetKey[] } {
  const previous = new Set(input.previousKeys)
  const required = new Set(input.requiredKeys)
  const added: DiagnosticVisualTargetKey[] = []
  const removed: DiagnosticVisualTargetKey[] = []
  const unchanged: DiagnosticVisualTargetKey[] = []
  for (const k of required) (previous.has(k) ? unchanged : added).push(k)
  for (const k of previous) if (!required.has(k)) removed.push(k)
  return { added, removed, unchanged }
}

/**
 * §3 — reconcile the ONE ACTIVE emphasis. It may ONLY add / move / remove the
 * active emphasis; it never yields a passive removal.
 */
export function reconcileActiveDiagnosticEmphasis(input: {
  previousActiveKey: DiagnosticVisualTargetKey | null
  nextActiveKey: DiagnosticVisualTargetKey | null
}): { toAdd: DiagnosticVisualTargetKey | null; toRemove: DiagnosticVisualTargetKey | null; passiveRemovals: readonly DiagnosticVisualTargetKey[] } {
  return {
    toAdd: input.nextActiveKey,
    toRemove: input.previousActiveKey !== input.nextActiveKey ? input.previousActiveKey : null,
    passiveRemovals: [],
  }
}

// ── §9 — stable identity vs VISUAL revision ────────────────────────────────

export interface HeadingVisualRevisionKey {
  documentKey: string
  stableHeadingIdentity: string
  contentFingerprint: string
  sourceRevision: number | null
  layoutEpoch: number
  numberingGeneration: number | null
  /** the raw numbering token the geometry was measured with (when present). */
  numberingToken?: string | null
}

/**
 * §9 — a stable identity only means "still the same heading node". The visual
 * geometry is valid only while the CONTENT fingerprint, the source revision, the
 * layout epoch and the numbering generation are all unchanged.
 */
export function buildHeadingVisualRevisionKey(input: HeadingVisualRevisionKey): string {
  return [
    input.documentKey,
    input.stableHeadingIdentity,
    input.contentFingerprint,
    input.sourceRevision ?? '-',
    input.layoutEpoch,
    input.numberingGeneration ?? '-',
    input.numberingToken ?? '-',
  ].join('|')
}

/** §9 — plugin-owned nodes never participate in the heading content fingerprint. */
export const HEADING_CONTENT_FINGERPRINT_EXCLUDED_SELECTORS: readonly string[] = [
  '.inkchapter-heading-diagnostic-layer',
  '.inkchapter-locate-document-layer',
  '.inkchapter-heading-diagnostic-reason',
  '.inkchapter-heading-diagnostic-marker',
  '[data-inkchapter-utility-root]',
  '[data-inkchapter-heading-number]',
]

export function computeHeadingContentFingerprint(input: {
  /** semantic text runs only (plugin-owned overlay nodes already excluded). */
  textRuns: readonly string[]
  level: number | null
  numberingToken: string | null
}): string {
  const text = input.textRuns.join('\u0000').replace(/\s+/g, ' ').trim()
  return `${input.level ?? '-'}::${text}::${input.numberingToken ?? '-'}`
}

export function headingVisualGeometryStillValid(
  before: HeadingVisualRevisionKey,
  after: HeadingVisualRevisionKey,
): boolean {
  return buildHeadingVisualRevisionKey(before) === buildHeadingVisualRevisionKey(after)
}

// ── §14 — text-tight coverage tolerance ────────────────────────────────────

/** 1~2px padding / antialias tolerance for the text-tight coverage gate. */
export const PASSIVE_TEXT_COVERAGE_TOLERANCE_PX_V514R3 = 2

export function passiveRightMinusCurrentTextRight(input: {
  passiveUnionRight: number | null
  currentTextRight: number | null
}): number | null {
  if (input.passiveUnionRight == null || input.currentTextRight == null) return null
  return input.passiveUnionRight - input.currentTextRight
}

/**
 * §14 — the passive carrier must not extend beyond the CURRENT heading text by
 * more than the approved tolerance (a deleted text run leaves no residual fill).
 */
export function passiveTextCoverageOk(input: {
  passiveUnionRight: number | null
  currentTextRight: number | null
}): boolean {
  const delta = passiveRightMinusCurrentTextRight(input)
  if (delta == null) return true
  return Math.abs(delta) <= PASSIVE_TEXT_COVERAGE_TOLERANCE_PX_V514R3
}

// ── §18/§19 — Active high-contrast colour scale ────────────────────────────

export type DiagnosticSeverityV514R3 = 'error' | 'warning' | 'info'

export interface SeverityAlphaScale {
  passiveBgAlpha: number
  activeBgAlpha: number
  passiveToken: string
  activeToken: string
  activeAccentToken: string
}

/** The DECLARED alpha scale (the stylesheet must use these exact tokens). */
export const DIAGNOSTIC_SEVERITY_ALPHA_V514R3: Readonly<Record<DiagnosticSeverityV514R3, SeverityAlphaScale>> = {
  error: {
    passiveBgAlpha: 0.12,
    activeBgAlpha: 0.32,
    passiveToken: '--ink-diagnostic-error-passive-bg',
    activeToken: '--ink-diagnostic-error-active-bg',
    activeAccentToken: '--ink-diagnostic-error-active-accent',
  },
  warning: {
    passiveBgAlpha: 0.13,
    activeBgAlpha: 0.38,
    passiveToken: '--ink-diagnostic-warning-passive-bg',
    activeToken: '--ink-diagnostic-warning-active-bg',
    activeAccentToken: '--ink-diagnostic-warning-active-accent',
  },
  info: {
    passiveBgAlpha: 0.07,
    activeBgAlpha: 0.18,
    passiveToken: '--ink-diagnostic-info-passive-bg',
    activeToken: '--ink-diagnostic-info-active-bg',
    activeAccentToken: '--ink-diagnostic-info-active-accent',
  },
}

export const ACTIVE_PASSIVE_ALPHA_MIN_RATIO_V514R3 = 2.4

export interface ActiveContrastDecision {
  severity: DiagnosticSeverityV514R3
  passiveFillAlpha: number
  activeFillAlpha: number
  activePassiveRatio: number
  activeToken: string
  passiveToken: string
  /** true when the active token is the passive token (a P12 violation). */
  activeReusesPassiveToken: boolean
  contrastOk: boolean
}

export function evaluateActiveContrast(severity: DiagnosticSeverityV514R3): ActiveContrastDecision {
  const s = DIAGNOSTIC_SEVERITY_ALPHA_V514R3[severity]
  const ratio = s.passiveBgAlpha > 0 ? s.activeBgAlpha / s.passiveBgAlpha : 0
  const activeReusesPassiveToken = s.activeToken === s.passiveToken
  return {
    severity,
    passiveFillAlpha: s.passiveBgAlpha,
    activeFillAlpha: s.activeBgAlpha,
    activePassiveRatio: ratio,
    activeToken: s.activeToken,
    passiveToken: s.passiveToken,
    activeReusesPassiveToken,
    contrastOk: !activeReusesPassiveToken && ratio >= ACTIVE_PASSIVE_ALPHA_MIN_RATIO_V514R3,
  }
}

// ── §6/§16/§19 — the R3 hard-gate counters ─────────────────────────────────

export const PASSIVE_ACTIVE_V514R3_GATE_KEYS = [
  // P10
  'activeSelectChangedPassiveTargetSet',
  'passiveMarkerRemovedByActiveLocate',
  'passiveMarkerSuppressedBySelectedDiagnostic',
  'passiveTargetCountChangedWithoutDiagnosticChange',
  'activeVisualTargetNotInPassiveSet',
  'siblingPassiveMarkerLostAfterActiveSwitch',
  'documentClickClearedPassiveMarker',
  'locatableHeadingDiagnosticWithoutVisualTarget',
  'headingMultiTargetPassiveMissing',
  // P11
  'headingTextChangedWithoutVisualInvalidation',
  'headingContentFingerprintChangedWithSameVisualSnapshot',
  'passiveFragmentRectStaleAfterTextEdit',
  'activeFragmentRectStaleAfterTextEdit',
  'reasonChipAnchorStaleAfterTextEdit',
  'passiveFragmentTextCoverageMismatch',
  'passiveFragmentExtendsIntoDeletedTextArea',
  'staleHeadingReasonChipAfterDiagnosticResolved',
  'staleHeadingPassiveMarkerAfterDiagnosticResolved',
  'staleHeadingActiveMarkerAfterDiagnosticResolved',
  // P12
  'errorActivePassiveContrastRatioLt24',
  'warningActivePassiveContrastRatioLt24',
  'activeErrorUsesPassiveColorToken',
  'activeWarningUsesPassiveColorToken',
] as const

export type PassiveActiveV514R3GateKey = typeof PASSIVE_ACTIVE_V514R3_GATE_KEYS[number]

export const PASSIVE_ACTIVE_V514R3_GATE_LABELS: Readonly<Record<PassiveActiveV514R3GateKey, string>> = {
  activeSelectChangedPassiveTargetSet: 'ACTIVE_SELECT_CHANGED_PASSIVE_TARGET_SET_COUNT',
  passiveMarkerRemovedByActiveLocate: 'PASSIVE_MARKER_REMOVED_BY_ACTIVE_LOCATE_COUNT',
  passiveMarkerSuppressedBySelectedDiagnostic: 'PASSIVE_MARKER_SUPPRESSED_BY_SELECTED_DIAGNOSTIC_COUNT',
  passiveTargetCountChangedWithoutDiagnosticChange: 'PASSIVE_TARGET_COUNT_CHANGED_WITHOUT_DIAGNOSTIC_CHANGE_COUNT',
  activeVisualTargetNotInPassiveSet: 'ACTIVE_VISUAL_TARGET_NOT_IN_PASSIVE_SET_COUNT',
  siblingPassiveMarkerLostAfterActiveSwitch: 'SIBLING_PASSIVE_MARKER_LOST_AFTER_ACTIVE_SWITCH_COUNT',
  documentClickClearedPassiveMarker: 'DOCUMENT_CLICK_CLEARED_PASSIVE_MARKER_COUNT',
  locatableHeadingDiagnosticWithoutVisualTarget: 'LOCATABLE_HEADING_DIAGNOSTIC_WITHOUT_VISUAL_TARGET_COUNT',
  headingMultiTargetPassiveMissing: 'HEADING_MULTI_TARGET_PASSIVE_MISSING_COUNT',
  headingTextChangedWithoutVisualInvalidation: 'HEADING_TEXT_CHANGED_WITHOUT_VISUAL_INVALIDATION_COUNT',
  headingContentFingerprintChangedWithSameVisualSnapshot: 'HEADING_CONTENT_FINGERPRINT_CHANGED_WITH_SAME_VISUAL_SNAPSHOT_COUNT',
  passiveFragmentRectStaleAfterTextEdit: 'PASSIVE_FRAGMENT_RECT_STALE_AFTER_TEXT_EDIT_COUNT',
  activeFragmentRectStaleAfterTextEdit: 'ACTIVE_FRAGMENT_RECT_STALE_AFTER_TEXT_EDIT_COUNT',
  reasonChipAnchorStaleAfterTextEdit: 'REASON_CHIP_ANCHOR_STALE_AFTER_TEXT_EDIT_COUNT',
  passiveFragmentTextCoverageMismatch: 'PASSIVE_FRAGMENT_TEXT_COVERAGE_MISMATCH_COUNT',
  passiveFragmentExtendsIntoDeletedTextArea: 'PASSIVE_FRAGMENT_EXTENDS_INTO_DELETED_TEXT_AREA_COUNT',
  staleHeadingReasonChipAfterDiagnosticResolved: 'STALE_HEADING_REASON_CHIP_AFTER_DIAGNOSTIC_RESOLVED_COUNT',
  staleHeadingPassiveMarkerAfterDiagnosticResolved: 'STALE_HEADING_PASSIVE_MARKER_AFTER_DIAGNOSTIC_RESOLVED_COUNT',
  staleHeadingActiveMarkerAfterDiagnosticResolved: 'STALE_HEADING_ACTIVE_MARKER_AFTER_DIAGNOSTIC_RESOLVED_COUNT',
  errorActivePassiveContrastRatioLt24: 'ERROR_ACTIVE_PASSIVE_CONTRAST_RATIO_LT_2_4_COUNT',
  warningActivePassiveContrastRatioLt24: 'WARNING_ACTIVE_PASSIVE_CONTRAST_RATIO_LT_2_4_COUNT',
  activeErrorUsesPassiveColorToken: 'ACTIVE_ERROR_USES_PASSIVE_COLOR_TOKEN_COUNT',
  activeWarningUsesPassiveColorToken: 'ACTIVE_WARNING_USES_PASSIVE_COLOR_TOKEN_COUNT',
}

export type PassiveActiveV514R3Counters = Record<PassiveActiveV514R3GateKey, number>

export function createPassiveActiveV514R3Counters(): PassiveActiveV514R3Counters {
  return PASSIVE_ACTIVE_V514R3_GATE_KEYS.reduce((acc, key) => {
    acc[key] = 0
    return acc
  }, {} as PassiveActiveV514R3Counters)
}

export function formatPassiveActiveV514R3GateReport(
  counters: Readonly<PassiveActiveV514R3Counters>,
): string[] {
  return PASSIVE_ACTIVE_V514R3_GATE_KEYS.map(key => `${PASSIVE_ACTIVE_V514R3_GATE_LABELS[key]}=${counters[key] ?? 0}`)
}

export function evaluatePassiveActiveV514R3Gates(
  counters: Readonly<PassiveActiveV514R3Counters>,
): { decision: 'PASS' | 'FAIL'; failedChecks: PassiveActiveV514R3GateKey[] } {
  const failedChecks = PASSIVE_ACTIVE_V514R3_GATE_KEYS.filter(key => (counters[key] ?? 0) !== 0)
  return { decision: failedChecks.length === 0 ? 'PASS' : 'FAIL', failedChecks }
}

/** §19 — the alpha contrast feeds the P12 gates. */
export function activeContrastToGateCounters(
  decisions: readonly ActiveContrastDecision[],
): Pick<PassiveActiveV514R3Counters,
  'errorActivePassiveContrastRatioLt24' | 'warningActivePassiveContrastRatioLt24'
  | 'activeErrorUsesPassiveColorToken' | 'activeWarningUsesPassiveColorToken'> {
  const out = {
    errorActivePassiveContrastRatioLt24: 0,
    warningActivePassiveContrastRatioLt24: 0,
    activeErrorUsesPassiveColorToken: 0,
    activeWarningUsesPassiveColorToken: 0,
  }
  for (const d of decisions) {
    if (d.severity === 'error') {
      if (d.activePassiveRatio < ACTIVE_PASSIVE_ALPHA_MIN_RATIO_V514R3) out.errorActivePassiveContrastRatioLt24++
      if (d.activeReusesPassiveToken) out.activeErrorUsesPassiveColorToken++
    } else if (d.severity === 'warning') {
      if (d.activePassiveRatio < ACTIVE_PASSIVE_ALPHA_MIN_RATIO_V514R3) out.warningActivePassiveContrastRatioLt24++
      if (d.activeReusesPassiveToken) out.activeWarningUsesPassiveColorToken++
    }
  }
  return out
}

export const PASSIVE_ACTIVE_STATE_AUDIT_EVENT = 'DOCUMENT-DIAGNOSTIC-PASSIVE-ACTIVE-STATE-AUDIT'
export const HEADING_EDIT_GEOMETRY_AUDIT_EVENT = 'DOCUMENT-DIAGNOSTIC-HEADING-EDIT-GEOMETRY-AUDIT'
export const ACTIVE_CONTRAST_AUDIT_EVENT = 'DOCUMENT-DIAGNOSTIC-ACTIVE-CONTRAST-AUDIT'
