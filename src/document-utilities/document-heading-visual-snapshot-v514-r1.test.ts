/**
 * V5.14-R1 (Phase 4) — HeadingDiagnosticVisualSnapshot (P4/P5).
 *
 * P4: fill and chip are projected from ONE snapshot (identity + layoutEpoch).
 * P5: `numberRectIncluded` false→true must invalidate + rebuild the chip ONCE.
 */
import { describe, expect, it } from 'vitest'
import {
  HEADING_VISUAL_SNAPSHOT_V514R1_GATE_KEYS,
  HEADING_VISUAL_SNAPSHOT_V514R1_GATE_LABELS,
  buildHeadingDiagnosticVisualSnapshot,
  buildHeadingVisualSnapshotAuditEntry,
  chipOverlapsHeadingText,
  createHeadingVisualSnapshotV514R1Counters,
  evaluateHeadingVisualSnapshotConsistency,
  evaluateHeadingVisualSnapshotV514R1Gates,
  formatHeadingVisualSnapshotV514R1GateReport,
  shouldRebuildForNumberRectFlip,
  type HeadingVisualRectSnapshot,
} from './document-heading-visual-snapshot-v514-r1'

const rect = (left: number, top: number, right: number, bottom: number): HeadingVisualRectSnapshot => ({
  left, top, right, bottom, width: right - left, height: bottom - top,
})

const TEXT = rect(100, 200, 360, 248)
const NUMBER = rect(60, 200, 96, 248)

function snapshot(numberRect: HeadingVisualRectSnapshot | null, epoch = 7) {
  return buildHeadingDiagnosticVisualSnapshot({
    documentKey: 'doc:key',
    stableHeadingIdentity: 'H6:idx:3',
    layoutEpoch: epoch,
    headingRect: rect(60, 200, 800, 248),
    textRect: TEXT,
    numberRect,
    severity: 'error',
    passive: true,
    active: false,
  })
}

describe('V5.14-R1 §13 — the ONE heading visual snapshot', () => {
  it('the chip anchor comes from the FINAL settled content right edge', () => {
    const withoutNumber = snapshot(null)
    expect(withoutNumber.numberRectIncluded).toBe(false)
    expect(withoutNumber.contentRight).toBe(TEXT.right)
    expect(withoutNumber.reasonChipAnchorX).toBe(TEXT.right)
    // the numbering rect extends the content once the controller stamps it
    const withNumber = snapshot(NUMBER)
    expect(withNumber.numberRectIncluded).toBe(true)
    expect(withNumber.contentRight).toBe(TEXT.right)
    // a number sitting to the RIGHT of the text must win the anchor
    const wide = buildHeadingDiagnosticVisualSnapshot({
      documentKey: 'doc:key', stableHeadingIdentity: 'H6:idx:3', layoutEpoch: 7,
      headingRect: rect(0, 0, 800, 48), textRect: TEXT, numberRect: rect(400, 200, 500, 248),
      severity: 'warning', passive: true, active: false,
    })
    expect(wide.contentRight).toBe(500)
  })

  it('P4: an identity-consistent paint reports NO mismatch; a divergent chip DOES', () => {
    const s = snapshot(null)
    const ok = evaluateHeadingVisualSnapshotConsistency(s, {
      fillIdentity: 'H6:idx:3', chipIdentity: 'H6:idx:3', paintLayoutEpoch: 7, domHeadingIdentity: 'H6:idx:3',
    })
    expect(ok.fillChipIdentityMismatch).toBe(false)
    expect(ok.fillChipLayoutEpochMismatch).toBe(false)
    // the chip bound to ANOTHER heading (the H4→H6 bug shape) is caught
    const bad = evaluateHeadingVisualSnapshotConsistency(s, {
      fillIdentity: 'H6:idx:3', chipIdentity: 'H4:idx:2', paintLayoutEpoch: 7, domHeadingIdentity: 'H6:idx:3',
    })
    expect(bad.fillChipIdentityMismatch).toBe(true)
    // so is a chip whose DOM wrapper claims a different identity
    const domDrift = evaluateHeadingVisualSnapshotConsistency(s, {
      fillIdentity: 'H6:idx:3', chipIdentity: 'H6:idx:3', paintLayoutEpoch: 7, domHeadingIdentity: 'H5:idx:1',
    })
    expect(domDrift.fillChipIdentityMismatch).toBe(true)
  })

  it('P4: a paint from a different layout epoch is a REAL violation', () => {
    const s = snapshot(null, 7)
    expect(evaluateHeadingVisualSnapshotConsistency(s, {
      fillIdentity: 'H6:idx:3', chipIdentity: 'H6:idx:3', paintLayoutEpoch: 7, domHeadingIdentity: 'H6:idx:3',
    }).fillChipLayoutEpochMismatch).toBe(false)
    expect(evaluateHeadingVisualSnapshotConsistency(s, {
      fillIdentity: 'H6:idx:3', chipIdentity: 'H6:idx:3', paintLayoutEpoch: 8, domHeadingIdentity: 'H6:idx:3',
    }).fillChipLayoutEpochMismatch).toBe(true)
  })

  it('§41: a chip covering the heading text is detected', () => {
    expect(chipOverlapsHeadingText(null, [TEXT])).toBe(false)
    expect(chipOverlapsHeadingText(rect(400, 200, 500, 248), [TEXT])).toBe(false)
    expect(chipOverlapsHeadingText(rect(300, 210, 420, 240), [TEXT])).toBe(true)
  })
})

describe('V5.14-R1 §15 — Duplicate Heading numberRect stability (P5)', () => {
  it('a numberRectIncluded false→true flip REQUIRES one invalidate + rebuild', () => {
    const before = snapshot(null)
    const after = snapshot(NUMBER)
    expect(shouldRebuildForNumberRectFlip(before, after)).toBe(true)
    // stable states never trigger a rebuild
    expect(shouldRebuildForNumberRectFlip(before, snapshot(null))).toBe(false)
    expect(shouldRebuildForNumberRectFlip(after, snapshot(NUMBER))).toBe(false)
    expect(shouldRebuildForNumberRectFlip(null, after)).toBe(false)
    // a DIFFERENT heading inheriting the map entry never triggers a rebuild
    const other = buildHeadingDiagnosticVisualSnapshot({
      documentKey: 'doc:key', stableHeadingIdentity: 'H5:idx:9', layoutEpoch: 7,
      headingRect: rect(0, 0, 800, 48), textRect: TEXT, numberRect: NUMBER,
      severity: 'warning', passive: true, active: false,
    })
    expect(shouldRebuildForNumberRectFlip(before, other)).toBe(false)
  })

  it('the audit entry records the rebuild so a stale chip can never pass silently', () => {
    const s = snapshot(NUMBER)
    const rebuilt = buildHeadingVisualSnapshotAuditEntry({
      snapshot: s, chipRect: rect(400, 212, 500, 236), chipGapPx: 40, numberRectFlipRebuilt: true,
    })
    expect(rebuilt.numberRectIncluded).toBe(true)
    expect(rebuilt.numberRectFlipRebuilt).toBe(true)
    expect(rebuilt.fillHeadingIdentity).toBe(rebuilt.headingIdentity)
    expect(rebuilt.chipHeadingIdentity).toBe(rebuilt.headingIdentity)
    expect(rebuilt.decision).toBe('PASS')
    // a placed chip with NO measurable gap is the inconsistent shape
    const bad = buildHeadingVisualSnapshotAuditEntry({
      snapshot: s, chipRect: rect(400, 212, 500, 236), chipGapPx: null, numberRectFlipRebuilt: false,
    })
    expect(bad.decision).toBe('FAIL')
  })

  it('§41: the 4 Heading snapshot gate keys are complete and 0 ⇒ PASS', () => {
    expect(HEADING_VISUAL_SNAPSHOT_V514R1_GATE_KEYS).toHaveLength(4)
    expect(Object.keys(HEADING_VISUAL_SNAPSHOT_V514R1_GATE_LABELS)).toHaveLength(4)
    const counters = createHeadingVisualSnapshotV514R1Counters()
    expect(evaluateHeadingVisualSnapshotV514R1Gates(counters).decision).toBe('PASS')
    const report = formatHeadingVisualSnapshotV514R1GateReport(counters)
    for (const label of [
      'HEADING_MARKER_FILL_CHIP_IDENTITY_MISMATCH_COUNT',
      'HEADING_MARKER_FILL_CHIP_LAYOUT_EPOCH_MISMATCH_COUNT',
      'HEADING_REASON_CHIP_OVERLAP_TEXT_COUNT',
      'HEADING_REASON_CHIP_GAP_LT_4PX_COUNT',
    ]) expect(report).toContain(`${label}=0`)
    counters.reasonChipOverlapText = 1
    expect(evaluateHeadingVisualSnapshotV514R1Gates(counters).failedChecks).toEqual(['reasonChipOverlapText'])
  })
})
