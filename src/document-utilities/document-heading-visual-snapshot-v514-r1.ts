/**
 * V5.14-R1 (Phase 4) — Heading Diagnostic Visual Snapshot.
 *
 * P4: the editor FILL and the REASON CHIP must be painted from ONE snapshot, so
 *     they can never bind to different headings / layout epochs.
 * P5: `numberRectIncluded` flipping false→true inside one transaction (the
 *     numbering controller stamps `data-inkchapter-heading-number` asynchronously)
 *     MUST invalidate the old chip geometry and rebuild ONCE — never leave a stale
 *     chip on the page.
 *
 * Pure contract: no DOM, no host state.
 */
export type HeadingVisualSeverity = 'error' | 'warning' | 'info'

export interface HeadingVisualRectSnapshot {
  left: number
  top: number
  right: number
  bottom: number
  width: number
  height: number
}

/** §13 — the ONE snapshot the fill AND the chip both consume. */
export interface HeadingDiagnosticVisualSnapshot {
  documentKey: string
  stableHeadingIdentity: string
  layoutEpoch: number

  headingRect: HeadingVisualRectSnapshot
  textRect: HeadingVisualRectSnapshot
  numberRect: HeadingVisualRectSnapshot | null
  /** §15 — true once the numbering decoration is part of the measured content. */
  numberRectIncluded: boolean

  /** The right edge of the heading's rendered CONTENT (number + text). */
  contentRight: number
  /** §5 — the chip anchor derived from the FINAL settled content right edge. */
  reasonChipAnchorX: number

  severity: HeadingVisualSeverity
  passive: boolean
  active: boolean
}

export function buildHeadingDiagnosticVisualSnapshot(input: {
  documentKey: string
  stableHeadingIdentity: string
  layoutEpoch: number
  headingRect: HeadingVisualRectSnapshot
  textRect: HeadingVisualRectSnapshot
  numberRect: HeadingVisualRectSnapshot | null
  severity: HeadingVisualSeverity
  passive: boolean
  active: boolean
}): HeadingDiagnosticVisualSnapshot {
  const numberRectIncluded = input.numberRect != null
  // §5/§15 — the chip anchors on the FINAL content right edge: the numbering rect
  // when it is part of the settled content, otherwise the text right edge.
  const contentRight = numberRectIncluded
    ? Math.max(input.numberRect!.right, input.textRect.right)
    : input.textRect.right
  return {
    documentKey: input.documentKey,
    stableHeadingIdentity: input.stableHeadingIdentity,
    layoutEpoch: input.layoutEpoch,
    headingRect: input.headingRect,
    textRect: input.textRect,
    numberRect: input.numberRect,
    numberRectIncluded,
    contentRight,
    reasonChipAnchorX: contentRight,
    severity: input.severity,
    passive: input.passive,
    active: input.active,
  }
}

/**
 * §41 — fill/chip consistency. Both MUST carry the snapshot's own identity and
 * the snapshot's layoutEpoch; a mismatch is a REAL violation (never masked).
 */
export function evaluateHeadingVisualSnapshotConsistency(
  snapshot: HeadingDiagnosticVisualSnapshot,
  observed: {
    /** the identity the FILL was painted for */
    fillIdentity: string | null
    /** the identity the CHIP was painted for */
    chipIdentity: string | null
    /** the layout epoch at the moment of paint */
    paintLayoutEpoch: number
    /** identity the DOM wrapper declares the chip belongs to */
    domHeadingIdentity: string | null
  },
): { fillChipIdentityMismatch: boolean; fillChipLayoutEpochMismatch: boolean } {
  const expected = snapshot.stableHeadingIdentity
  const identityMismatch =
    (observed.fillIdentity != null && observed.fillIdentity !== expected)
    || (observed.chipIdentity != null && observed.chipIdentity !== expected)
    || (observed.chipIdentity != null && observed.domHeadingIdentity != null
      && observed.chipIdentity !== observed.domHeadingIdentity)
  return {
    fillChipIdentityMismatch: identityMismatch,
    fillChipLayoutEpochMismatch: observed.paintLayoutEpoch !== snapshot.layoutEpoch,
  }
}

/**
 * §15 — the numbering rect entered the measured content between two passes of the
 * SAME heading → the previous chip geometry is stale and must be rebuilt once.
 */
export function shouldRebuildForNumberRectFlip(
  previous: HeadingDiagnosticVisualSnapshot | null,
  next: HeadingDiagnosticVisualSnapshot,
): boolean {
  if (!previous) return false
  if (previous.stableHeadingIdentity !== next.stableHeadingIdentity) return false
  return previous.numberRectIncluded === false && next.numberRectIncluded === true
}

/** §41 — the reason chip must NEVER cover the heading's own text. */
export function chipOverlapsHeadingText(
  chip: HeadingVisualRectSnapshot | null,
  textRects: readonly HeadingVisualRectSnapshot[],
): boolean {
  if (!chip) return false
  for (const t of textRects) {
    const left = Math.max(chip.left, t.left)
    const right = Math.min(chip.right, t.right)
    const top = Math.max(chip.top, t.top)
    const bottom = Math.min(chip.bottom, t.bottom)
    if (right - left > 0.5 && bottom - top > 0.5) return true
  }
  return false
}

// ── V5.14-R1 §41 — the Heading visual-snapshot hard gates (all must be 0) ───

export const HEADING_VISUAL_SNAPSHOT_V514R1_GATE_KEYS = [
  'fillChipIdentityMismatch',
  'fillChipLayoutEpochMismatch',
  'reasonChipOverlapText',
  'reasonChipGapLt4px',
] as const

export type HeadingVisualSnapshotV514R1GateKey = typeof HEADING_VISUAL_SNAPSHOT_V514R1_GATE_KEYS[number]

export const HEADING_VISUAL_SNAPSHOT_V514R1_GATE_LABELS: Readonly<Record<HeadingVisualSnapshotV514R1GateKey, string>> = {
  fillChipIdentityMismatch: 'HEADING_MARKER_FILL_CHIP_IDENTITY_MISMATCH_COUNT',
  fillChipLayoutEpochMismatch: 'HEADING_MARKER_FILL_CHIP_LAYOUT_EPOCH_MISMATCH_COUNT',
  reasonChipOverlapText: 'HEADING_REASON_CHIP_OVERLAP_TEXT_COUNT',
  reasonChipGapLt4px: 'HEADING_REASON_CHIP_GAP_LT_4PX_COUNT',
}

export type HeadingVisualSnapshotV514R1Counters = Record<HeadingVisualSnapshotV514R1GateKey, number>

export function createHeadingVisualSnapshotV514R1Counters(): HeadingVisualSnapshotV514R1Counters {
  return HEADING_VISUAL_SNAPSHOT_V514R1_GATE_KEYS.reduce((acc, k) => {
    acc[k] = 0
    return acc
  }, {} as HeadingVisualSnapshotV514R1Counters)
}

export function formatHeadingVisualSnapshotV514R1GateReport(
  counters: Readonly<HeadingVisualSnapshotV514R1Counters>,
): string[] {
  return HEADING_VISUAL_SNAPSHOT_V514R1_GATE_KEYS.map(
    k => `${HEADING_VISUAL_SNAPSHOT_V514R1_GATE_LABELS[k]}=${counters[k] ?? 0}`,
  )
}

export function evaluateHeadingVisualSnapshotV514R1Gates(
  counters: Readonly<HeadingVisualSnapshotV514R1Counters>,
): { decision: 'PASS' | 'FAIL'; failedChecks: HeadingVisualSnapshotV514R1GateKey[] } {
  const failedChecks = HEADING_VISUAL_SNAPSHOT_V514R1_GATE_KEYS.filter(k => (counters[k] ?? 0) !== 0)
  return { decision: failedChecks.length === 0 ? 'PASS' : 'FAIL', failedChecks }
}

// ── §37/§40 — the Heading visual-snapshot runtime audit ────────────────────

export const HEADING_VISUAL_SNAPSHOT_AUDIT_EVENT = 'DOCUMENT-DIAGNOSTIC-HEADING-VISUAL-SNAPSHOT-AUDIT'

export interface HeadingVisualSnapshotAuditEntry {
  headingIdentity: string
  layoutEpoch: number
  fillHeadingIdentity: string
  chipHeadingIdentity: string | null
  textRect: HeadingVisualRectSnapshot
  numberRect: HeadingVisualRectSnapshot | null
  contentRight: number
  chipLeft: number | null
  chipGapPx: number | null
  numberRectIncluded: boolean
  numberRectFlipRebuilt: boolean
  severity: HeadingVisualSeverity
  decision: 'PASS' | 'FAIL'
}

export function buildHeadingVisualSnapshotAuditEntry(input: {
  snapshot: HeadingDiagnosticVisualSnapshot
  chipRect: HeadingVisualRectSnapshot | null
  chipGapPx: number | null
  numberRectFlipRebuilt: boolean
}): HeadingVisualSnapshotAuditEntry {
  const { snapshot, chipRect, chipGapPx, numberRectFlipRebuilt } = input
  const identityStable = chipRect == null || chipGapPx != null
  return {
    headingIdentity: snapshot.stableHeadingIdentity,
    layoutEpoch: snapshot.layoutEpoch,
    // both are sourced from the SAME snapshot, so they can never disagree
    fillHeadingIdentity: snapshot.stableHeadingIdentity,
    chipHeadingIdentity: chipRect ? snapshot.stableHeadingIdentity : null,
    textRect: snapshot.textRect,
    numberRect: snapshot.numberRect,
    contentRight: snapshot.contentRight,
    chipLeft: chipRect ? chipRect.left : null,
    chipGapPx,
    numberRectIncluded: snapshot.numberRectIncluded,
    numberRectFlipRebuilt,
    severity: snapshot.severity,
    decision: identityStable ? 'PASS' : 'FAIL',
  }
}
