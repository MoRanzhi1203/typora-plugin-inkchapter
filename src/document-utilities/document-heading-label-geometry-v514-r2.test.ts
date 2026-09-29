import { describe, expect, it } from 'vitest'
import {
  buildHeadingLabelGeometrySnapshot,
  classifyHeadingNumberPlacement,
  createHeadingLabelGeometryV514R2Counters,
  evaluateHeadingChipAnchorAuthority,
  evaluateHeadingLabelGeometryV514R2Gates,
  formatHeadingLabelGeometryV514R2GateReport,
  HEADING_LABEL_CHIP_GAP_PX,
  HEADING_LABEL_GEOMETRY_V514R2_GATE_KEYS,
  type HeadingLabelRect,
} from './document-heading-label-geometry-v514-r2'

function rect(left: number, top: number, right: number, bottom: number): HeadingLabelRect {
  return { left, top, right, bottom, width: right - left, height: bottom - top }
}

const GAP = HEADING_LABEL_CHIP_GAP_PX

describe('V5.14-R2 P5-R2 — Heading LABEL geometry authority', () => {
  it('P5R2-01 — PREFIX number never pushes the chip: anchor = last line right + gap', () => {
    // the墨章 number is an attribute-driven ::before gutter on the FIRST line band,
    // while the chip must clear the LAST visible line (which can end far to the left).
    const line1 = rect(354.99, 491.46, 430, 524.26)
    const line2 = rect(70.49, 524.26, 142.49, 557.06)
    const number = rect(314.5, 491.46, 354.99, 524.26)
    const snapshot = buildHeadingLabelGeometrySnapshot({
      documentKey: 'doc',
      stableHeadingIdentity: 'H3:idx:5',
      layoutEpoch: 4,
      textRects: [line1, line2],
      numberRect: number,
      gapPx: GAP,
    })!
    expect(snapshot.numberPlacement).toBe('PREFIX')
    expect(snapshot.numberRectParticipatesInAnchor).toBe(false)
    // the anchor follows the LAST LINE's right edge, never the number gutter (354.99)
    expect(snapshot.visualLabelRight).toBe(142.49)
    expect(snapshot.reasonChipAnchorX).toBe(142.49 + GAP)
    // this is exactly the observed runtime chipLeft (150.49)
    expect(snapshot.reasonChipAnchorX).toBe(150.49)
  })

  it('P5R2-02 — SUFFIX number participates: anchor = union right + gap', () => {
    const last = rect(70, 100, 200, 130)
    const number = rect(206, 100, 260, 130)
    const snapshot = buildHeadingLabelGeometrySnapshot({
      documentKey: 'doc',
      stableHeadingIdentity: 'H2:idx:1',
      layoutEpoch: 7,
      textRects: [last],
      numberRect: number,
      gapPx: GAP,
    })!
    expect(snapshot.numberPlacement).toBe('SUFFIX')
    expect(snapshot.numberRectParticipatesInAnchor).toBe(true)
    expect(snapshot.visualLabelRight).toBe(260)
    expect(snapshot.reasonChipAnchorX).toBe(260 + GAP)
  })

  it('P5R2-03 — DETACHED number is not used as an anchor and is gate-able', () => {
    // the number sits on a completely different line band → cannot be a label part
    const detached = rect(10, 10, 40, 30)
    const text = rect(70, 400, 150, 430)
    expect(classifyHeadingNumberPlacement(detached, [text])).toBe('DETACHED')
    const snapshot = buildHeadingLabelGeometrySnapshot({
      documentKey: 'doc',
      stableHeadingIdentity: 'H4:idx:9',
      layoutEpoch: 2,
      textRects: [text],
      numberRect: detached,
      gapPx: GAP,
    })!
    expect(snapshot.reasonChipAnchorX).toBe(150 + GAP)
    // and if a DETACHED number ever DID participate, the gate must fire
    const violated = evaluateHeadingChipAnchorAuthority({
      snapshot: { ...snapshot, numberRectParticipatesInAnchor: true },
      actualChipLeft: 150 + GAP,
      actualChipGapPx: GAP,
      paintLayoutEpoch: 2,
    })
    expect(violated.detachedUsedAsAnchor).toBe(true)
  })

  it('P5R2-04 — the real runtime anomaly is CLASSIFIED, not silently mixed', () => {
    // measured: numberRect.right≈354.99, lastText.right≈142.49, chipLeft≈150.49
    const numberOnFirstLine = rect(314.5, 491.46, 354.99, 524.26)
    const firstLineText = rect(354.99, 491.46, 430, 524.26)
    const chipFollowedLastText = rect(70.49, 459.46, 142.49, 492.26)
    const snapshot = buildHeadingLabelGeometrySnapshot({
      documentKey: 'doc',
      stableHeadingIdentity: 'H3:idx:5',
      layoutEpoch: 5,
      textRects: [firstLineText, chipFollowedLastText],
      numberRect: numberOnFirstLine,
      gapPx: GAP,
    })!
    // PREFIX → the label right is the right-most TEXT, never max(number.right, text.right)
    const oldWrongContentRight = Math.max(numberOnFirstLine.right, chipFollowedLastText.right)
    expect(oldWrongContentRight).toBe(354.99)
    expect(snapshot.visualLabelRight).toBe(430)
    expect(snapshot.visualLabelRight).not.toBe(oldWrongContentRight)
    // the painted chip (142.49 + 8) is therefore CORRECT for this authority
    const evalOk = evaluateHeadingChipAnchorAuthority({
      snapshot,
      actualChipLeft: 142.49 + GAP,
      actualChipGapPx: GAP,
      paintLayoutEpoch: 5,
    })
    expect(evalOk.anchorAuthorityOk).toBe(false)
    expect(evalOk.prefixPushedChip).toBe(false)
  })

  it('P5R2-05 — a PREFIX number that pushed the chip past the label is a gate', () => {
    // a PREFIX gutter always ENDS at the first fragment's left edge, so it can never
    // itself exceed the label right — but a chip anchored on the gutter (e.g. from a
    // misparsed rect) would land past the label and must be gated.
    const firstLineText = rect(70, 100, 200, 130)
    const number = rect(20, 100, 70, 130)
    const snapshot = buildHeadingLabelGeometrySnapshot({
      documentKey: 'doc',
      stableHeadingIdentity: 'H3:idx:5',
      layoutEpoch: 3,
      textRects: [firstLineText],
      numberRect: number,
      gapPx: GAP,
    })!
    expect(snapshot.numberPlacement).toBe('PREFIX')
    expect(snapshot.reasonChipAnchorX).toBe(200 + GAP)
    const pushed = evaluateHeadingChipAnchorAuthority({
      snapshot,
      actualChipLeft: 999,
      actualChipGapPx: GAP,
      paintLayoutEpoch: 3,
    })
    expect(pushed.prefixPushedChip).toBe(true)
    expect(pushed.anchorAuthorityOk).toBe(false)
  })

  it('P5R2-05b — a number whose band does not match the label is DETACHED, never the anchor', () => {
    const text = rect(70.49, 459.46, 142.49, 492.26)
    const numberOnAnotherBand = rect(314.5, 491.46, 354.99, 524.26)
    const snapshot = buildHeadingLabelGeometrySnapshot({
      documentKey: 'doc',
      stableHeadingIdentity: 'H3:idx:5',
      layoutEpoch: 5,
      textRects: [text],
      numberRect: numberOnAnotherBand,
      gapPx: GAP,
    })!
    // DETACHED → the number must NOT move the anchor (this is the exact probe that
    // previously produced contentRight=354.99 against a 142.49 label)
    expect(snapshot.numberPlacement).toBe('DETACHED')
    expect(snapshot.reasonChipAnchorX).toBe(142.49 + GAP)
    expect(snapshot.visualLabelRight).toBe(142.49)
  })

  it('P5R2-06 — anchor/epoch authority mismatches are detected', () => {
    const text = rect(70, 100, 200, 130)
    const snapshot = buildHeadingLabelGeometrySnapshot({
      documentKey: 'doc',
      stableHeadingIdentity: 'H2:idx:1',
      layoutEpoch: 11,
      textRects: [text],
      numberRect: null,
      gapPx: GAP,
    })!
    expect(snapshot.numberPlacement).toBe('ABSENT')
    expect(snapshot.numberRectParticipatesInAnchor).toBe(false)
    // wrong X
    expect(evaluateHeadingChipAnchorAuthority({
      snapshot, actualChipLeft: 999, actualChipGapPx: GAP, paintLayoutEpoch: 11,
    }).anchorAuthorityOk).toBe(false)
    // right X but a stale epoch
    const staleEpoch = evaluateHeadingChipAnchorAuthority({
      snapshot, actualChipLeft: 200 + GAP, actualChipGapPx: GAP, paintLayoutEpoch: 10,
    })
    expect(staleEpoch.anchorAuthorityOk).toBe(true)
    expect(staleEpoch.anchorFromSettledGeometry).toBe(false)
  })

  it('P5R2-07 — gate report / decision and unmeasurable text', () => {
    const counters = createHeadingLabelGeometryV514R2Counters()
    EXPECTED_GATE_LABELS.forEach((label, i) => {
      expect(formatHeadingLabelGeometryV514R2GateReport(counters)[i]).toBe(`${label}=0`)
    })
    expect(evaluateHeadingLabelGeometryV514R2Gates(counters).decision).toBe('PASS')
    counters.reasonChipAnchorAuthorityMismatch = 1
    const failed = evaluateHeadingLabelGeometryV514R2Gates(counters)
    expect(failed.decision).toBe('FAIL')
    expect(failed.failedChecks).toEqual(['reasonChipAnchorAuthorityMismatch'])
    // no measurable text → no authority at all (never a fabricated anchor)
    expect(buildHeadingLabelGeometrySnapshot({
      documentKey: 'doc',
      stableHeadingIdentity: 'H2:idx:1',
      layoutEpoch: 1,
      textRects: [],
      numberRect: null,
      gapPx: GAP,
    })).toBeNull()
  })
})

const EXPECTED_GATE_LABELS = [
  'HEADING_NUMBER_RECT_SEMANTIC_MISMATCH_COUNT',
  'HEADING_REASON_CHIP_ANCHOR_AUTHORITY_MISMATCH_COUNT',
  'HEADING_REASON_CHIP_ANCHOR_NOT_FROM_SETTLED_GEOMETRY_COUNT',
  'HEADING_NUMBER_RECT_DETACHED_USED_AS_ANCHOR_COUNT',
  'HEADING_NUMBER_RECT_SUFFIX_IGNORED_COUNT',
  'HEADING_NUMBER_RECT_PREFIX_PUSHED_CHIP_COUNT',
  'HEADING_NUMBER_RECT_FLIP_STALE_CHIP_SURVIVED_COUNT',
  'HEADING_NUMBER_RECT_FLIP_REBUILD_GT_ONE_COUNT',
]

it('P5R2-08 — the gate label list is complete and correctly ordered', () => {
  expect(HEADING_LABEL_GEOMETRY_V514R2_GATE_KEYS).toHaveLength(EXPECTED_GATE_LABELS.length)
  expect(formatHeadingLabelGeometryV514R2GateReport(createHeadingLabelGeometryV514R2Counters()))
    .toEqual(EXPECTED_GATE_LABELS.map(l => `${l}=0`))
})
