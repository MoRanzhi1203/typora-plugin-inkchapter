/**
 * V5.14-R4 — Heading Number + Gap ATOMIC reconcile.
 *
 * ROOT_R4_1 = the body committed `applyNumberingDiff(labels)` and
 *   `applyLabelGaps(gaps)` as TWO independent transactions over TWO arrays.
 * ROOT_R4_2 = `repairDecoration()` never touched the gap at all, and the service
 *   re-applied gaps only `if (this.renderedGaps)` — after a document switch /
 *   `clearNumbering()` that cache is null, so a label could be committed with the
 *   gap silently missing (the observed "2.1第一节" flip).
 * ROOT_R4_3 = `isRenderedStateValid()` validated class+label only, `areGapsValid()`
 *   validated gaps only (and returned TRUE early when the array was short), so
 *   gap parity was never enforced by the fast path; the outline VERIFY compared
 *   counts only.
 * ROOT_R4_4 = a text-only heading edit can replace the native node → repair path
 *   → gap re-applied only when the gap cache happened to be non-null.
 * ROOT_R4_5 = the outline projected `labelGaps[matchOrdinal]` while the array is
 *   indexed by BODY heading ordinal → the same projection was re-derived in a
 *   different index space (and `?? ''` silently degraded to "no gap").
 * ROOT_R4_6 = repair / fast path validated the label and the gap from different
 *   caches (`renderedStates` vs `renderedGaps`) at different call sites.
 *
 * The invariant this module encodes:
 *
 *   HeadingNumberDecorationState = { stableIdentity, label, gap }
 *
 * `label` and `gap` are the TWO projections of ONE business result. They are
 * NEVER committed separately, NEVER repaired separately, and the outline NEVER
 * re-derives the gap. `label` stays pure (no trailing space is ever folded in).
 *
 * Pure contract: no DOM, no host state.
 */

export type HeadingDecorationGap = 'space' | 'none'

export interface HeadingDecorationProjection {
  stableIdentity: string
  /** the PURE number label — never contains the spacing character. */
  label: string
  gap: HeadingDecorationGap
}

/** What the live DOM currently carries for one heading. */
export interface ActualHeadingDecoration {
  numberedClass: boolean
  label: string | null
  gap: HeadingDecorationGap
}

export const HEADING_DECORATION_NUMBERED_CLASS_V514R4 = 'inkchapter-numbered-heading'

/** Anything that is not the explicit `space` token means "no gap". */
export function normalizeDecorationGap(value: unknown): HeadingDecorationGap {
  return value === 'space' ? 'space' : 'none'
}

/**
 * §8 — build the ONE projection list. An EMPTY label always means `gap: none`
 * (a decoration cannot keep spacing without a number).
 */
export function buildHeadingDecorationProjections(
  numbered: readonly { key: string; label: string; labelGap?: unknown }[],
): HeadingDecorationProjection[] {
  return numbered.map(h => ({
    stableIdentity: h.key,
    label: h.label ?? '',
    gap: (h.label ?? '') === '' ? 'none' : normalizeDecorationGap(h.labelGap),
  }))
}

/** §8 — the gap of the BODY heading at `bodyIndex` (the outline's ONLY source). */
export function outlineGapForBodyIndex(
  projections: readonly HeadingDecorationProjection[] | null | undefined,
  bodyIndex: number,
  legacyLabelGaps?: readonly string[] | null,
): HeadingDecorationGap {
  const p = projections?.[bodyIndex]
  if (p) return p.label === '' ? 'none' : p.gap
  return normalizeDecorationGap(legacyLabelGaps?.[bodyIndex])
}

export function decorationGapAttributeValue(gap: HeadingDecorationGap): string | null {
  return gap === 'space' ? 'space' : null
}

export function headingDecorationMatches(
  expected: HeadingDecorationProjection,
  actual: ActualHeadingDecoration,
): boolean {
  if (expected.label === '') {
    return !actual.numberedClass && actual.label === null && actual.gap === 'none'
  }
  return actual.numberedClass && actual.label === expected.label && actual.gap === expected.gap
}

export type DecorationMismatchKind = 'none' | 'class' | 'label' | 'gap' | 'label+gap' | 'class+label' | 'class+gap' | 'class+label+gap'

export function decorationMismatchKind(
  expected: HeadingDecorationProjection,
  actual: ActualHeadingDecoration,
): DecorationMismatchKind {
  const parts: string[] = []
  if (expected.label === '') {
    if (actual.numberedClass) parts.push('class')
    if (actual.label !== null) parts.push('label')
    if (actual.gap !== 'none') parts.push('gap')
    return parts.length === 0 ? 'none' : (parts.join('+') as DecorationMismatchKind)
  }
  if (!actual.numberedClass) parts.push('class')
  if (actual.label !== expected.label) parts.push('label')
  if (actual.gap !== expected.gap) parts.push('gap')
  return parts.length === 0 ? 'none' : (parts.join('+') as DecorationMismatchKind)
}

/**
 * §13 — the core invariant: with the numbering SETTINGS and the semantic result
 * unchanged, a pure heading-text edit must not change any heading's gap.
 */
export function gapDriftedWithoutSettingsChange(input: {
  labelBefore: string
  labelAfter: string
  gapBefore: HeadingDecorationGap
  gapAfter: HeadingDecorationGap
  settingsChanged: boolean
  semanticChanged: boolean
}): boolean {
  if (input.settingsChanged || input.semanticChanged) return false
  if (input.labelBefore !== input.labelAfter) return false
  return input.gapBefore !== input.gapAfter
}

// ── §15 — the R4 hard gates ─────────────────────────────────────────────────

export const HEADING_DECORATION_V514R4_GATE_KEYS = [
  'headingNumberLabelMismatch',
  'headingNumberGapAttrMismatch',
  'headingNumberClassMismatch',
  'outlineNumberLabelMismatch',
  'outlineNumberGapAttrMismatch',
  'bodyOutlineLabelParityMismatch',
  'bodyOutlineGapParityMismatch',
  'numberLabelStableButGapChanged',
  'headingGapChangedWithoutSettingsChange',
  'decorationRepairPartialLabelWithoutGap',
  'decorationRepairPartialGapWithoutLabel',
  'fastPathAcceptedWithGapMismatch',
  'staleGapSurvivedReconcile',
  'staleGapSurvivedDocumentSwitch',
] as const

export type HeadingDecorationV514R4GateKey = typeof HEADING_DECORATION_V514R4_GATE_KEYS[number]

export const HEADING_DECORATION_V514R4_GATE_LABELS: Readonly<Record<HeadingDecorationV514R4GateKey, string>> = {
  headingNumberLabelMismatch: 'HEADING_NUMBER_LABEL_MISMATCH_COUNT',
  headingNumberGapAttrMismatch: 'HEADING_NUMBER_GAP_ATTR_MISMATCH_COUNT',
  headingNumberClassMismatch: 'HEADING_NUMBER_CLASS_MISMATCH_COUNT',
  outlineNumberLabelMismatch: 'OUTLINE_NUMBER_LABEL_MISMATCH_COUNT',
  outlineNumberGapAttrMismatch: 'OUTLINE_NUMBER_GAP_ATTR_MISMATCH_COUNT',
  bodyOutlineLabelParityMismatch: 'BODY_OUTLINE_LABEL_PARITY_MISMATCH_COUNT',
  bodyOutlineGapParityMismatch: 'BODY_OUTLINE_GAP_PARITY_MISMATCH_COUNT',
  numberLabelStableButGapChanged: 'NUMBER_LABEL_STABLE_BUT_GAP_CHANGED_COUNT',
  headingGapChangedWithoutSettingsChange: 'HEADING_GAP_CHANGED_WITHOUT_SETTINGS_CHANGE_COUNT',
  decorationRepairPartialLabelWithoutGap: 'DECORATION_REPAIR_PARTIAL_LABEL_WITHOUT_GAP_COUNT',
  decorationRepairPartialGapWithoutLabel: 'DECORATION_REPAIR_PARTIAL_GAP_WITHOUT_LABEL_COUNT',
  fastPathAcceptedWithGapMismatch: 'FAST_PATH_ACCEPTED_WITH_GAP_MISMATCH_COUNT',
  staleGapSurvivedReconcile: 'STALE_GAP_SURVIVED_RECONCILE_COUNT',
  staleGapSurvivedDocumentSwitch: 'STALE_GAP_SURVIVED_DOCUMENT_SWITCH_COUNT',
}

export type HeadingDecorationV514R4Counters = Record<HeadingDecorationV514R4GateKey, number>

export function createHeadingDecorationV514R4Counters(): HeadingDecorationV514R4Counters {
  return HEADING_DECORATION_V514R4_GATE_KEYS.reduce((acc, key) => {
    acc[key] = 0
    return acc
  }, {} as HeadingDecorationV514R4Counters)
}

export function formatHeadingDecorationV514R4GateReport(
  counters: Readonly<HeadingDecorationV514R4Counters>,
): string[] {
  return HEADING_DECORATION_V514R4_GATE_KEYS.map(key => `${HEADING_DECORATION_V514R4_GATE_LABELS[key]}=${counters[key] ?? 0}`)
}

export function evaluateHeadingDecorationV514R4Gates(
  counters: Readonly<HeadingDecorationV514R4Counters>,
): { decision: 'PASS' | 'FAIL'; failedChecks: HeadingDecorationV514R4GateKey[] } {
  const failedChecks = HEADING_DECORATION_V514R4_GATE_KEYS.filter(key => (counters[key] ?? 0) !== 0)
  return { decision: failedChecks.length === 0 ? 'PASS' : 'FAIL', failedChecks }
}

/**
 * §12 — body/outline parity: the same projection must reach both surfaces.
 * Returns the keys whose label or gap differ between the two surfaces.
 */
export function verifyBodyOutlineParity(
  body: readonly HeadingDecorationProjection[],
  outline: readonly { stableIdentity: string; label: string; gap: HeadingDecorationGap }[],
): { labelMismatch: number; gapMismatch: number; missingInOutline: number } {
  const byIdentity = new Map(outline.map(o => [o.stableIdentity, o]))
  let labelMismatch = 0
  let gapMismatch = 0
  let missingInOutline = 0
  for (const b of body) {
    const o = byIdentity.get(b.stableIdentity)
    if (!o) {
      if (b.label !== '') missingInOutline++
      continue
    }
    if (o.label !== b.label) labelMismatch++
    if (o.gap !== b.gap) gapMismatch++
  }
  return { labelMismatch, gapMismatch, missingInOutline }
}

export const HEADING_NUMBER_DECORATION_AUDIT_EVENT = 'HEADING-NUMBER-DECORATION-AUDIT'
export const OUTLINE_NUMBER_DECORATION_AUDIT_EVENT = 'OUTLINE-NUMBER-DECORATION-AUDIT'
