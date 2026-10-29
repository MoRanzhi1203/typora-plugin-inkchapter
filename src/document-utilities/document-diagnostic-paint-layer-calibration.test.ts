// @vitest-environment jsdom
/**
 * TRAE §29/§30 — PAINT LAYER CALIBRATION + FRAGMENT CLOSURE.
 *
 * Pure calibration tests (origin extraction, axis-aligned scale extraction,
 * affine inverse mapping, round trip ≤ 1px, scale ≠ 1 still closes, negative
 * layer origin still closes, non-affine / zero-basis fail closed) PLUS a jsdom
 * integration test with a FAKE translated + scaled paint layer that inserts
 * fragment-sized divs, re-measures them and asserts the painted viewport rect
 * ≈ the source viewport rect.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import {
  PAINT_LAYER_CALIBRATION_AUDIT_EVENT,
  BLANK_ROW_FRAGMENT_CLOSURE_AUDIT_EVENT,
  BLANK_ROW_FRAGMENT_MAX_DRIFT_PX,
  PAINT_LAYER_GEOMETRY_GATE_KEYS,
  PAINT_LAYER_GEOMETRY_GATE_LABELS,
  BLANK_ROW_TX_GATE_KEYS,
  BLANK_ROW_TX_GATE_LABELS,
  BLANK_ROW_HISTORICAL_COVERAGE_LABELS,
  calibratePaintLayerFromLayer,
  computeFragmentDrift,
  createBlankRowTxGates,
  createPaintLayerGeometryGates,
  derivePaintLayerCalibration,
  evaluateBlankRowTxGates,
  evaluateFragmentClosureEntry,
  evaluatePaintLayerGeometryGates,
  formatPaintLayerGeometryGateReport,
  maxFragmentDrift,
  paintLayerLocalRectToViewportV1,
  roundTripPaintLayerRectV1,
  viewportRectToPaintLayerLocalV1,
  type PaintLayerCalibration,
} from './document-diagnostic-paint-layer-calibration'
import type { RectLike } from './document-diagnostic-rendered-blank-row'

const rect = (left: number, top: number, right: number, bottom: number): RectLike => ({
  left, top, right, bottom, width: right - left, height: bottom - top,
})

/** Build a calibration the way the DOM helper would, from the three probe rects. */
function calib(input: {
  origin: RectLike
  basisX: { x: number; y: number }
  basisY: { x: number; y: number }
  distance?: number
}): PaintLayerCalibration {
  const d = input.distance ?? 100
  return derivePaintLayerCalibration({
    layoutEpoch: 1,
    layerConnected: true,
    layerRect: rect(0, 0, 900, 1600),
    originProbeViewportRect: input.origin,
    xProbeViewportRect: rect(input.origin.left + input.basisX.x, input.origin.top + input.basisX.y,
      input.origin.left + input.basisX.x + 1, input.origin.top + input.basisX.y + 1),
    yProbeViewportRect: rect(input.origin.left + input.basisY.x, input.origin.top + input.basisY.y,
      input.origin.left + input.basisY.x + 1, input.origin.top + input.basisY.y + 1),
    probeDistancePx: d,
  })
}

beforeEach(() => {
  document.body.innerHTML = ''
})
afterEach(() => {
  vi.restoreAllMocks()
})

describe('TRAE §4/§6 — calibration origin extraction', () => {
  it('reads the origin directly from the local(0,0) probe', () => {
    const c = calib({ origin: rect(100, 200, 101, 201), basisX: { x: 100, y: 0 }, basisY: { x: 0, y: 100 } })
    expect(c.decision).toBe('VERIFIED')
    expect(c.originViewportX).toBe(100)
    expect(c.originViewportY).toBe(200)
  })

  it('a disconnected / missing layer fails closed as LAYER_MISSING', () => {
    const c = derivePaintLayerCalibration({
      layoutEpoch: 1, layerConnected: false, layerRect: null,
      originProbeViewportRect: null, xProbeViewportRect: null, yProbeViewportRect: null,
    })
    expect(c.decision).toBe('LAYER_MISSING')
    expect(c.affineVerified).toBe(false)
  })

  it('an unmeasured probe fails closed as PROBE_MISSING', () => {
    const c = derivePaintLayerCalibration({
      layoutEpoch: 1, layerConnected: true, layerRect: rect(0, 0, 10, 10),
      originProbeViewportRect: rect(0, 0, 1, 1), xProbeViewportRect: null, yProbeViewportRect: null,
    })
    expect(c.decision).toBe('PROBE_MISSING')
  })
})

describe('TRAE §5 — axis-aligned scale extraction', () => {
  it('extracts scaleX / scaleY from the basis vectors', () => {
    const c = calib({ origin: rect(50, 0, 51, 1), basisX: { x: 150, y: 0 }, basisY: { x: 0, y: 125 } })
    expect(c.decision).toBe('VERIFIED')
    expect(c.scaleX).toBeCloseTo(1.5, 6)
    expect(c.scaleY).toBeCloseTo(1.25, 6)
    expect(c.axisAligned).toBe(true)
  })

  it('a non-axis-aligned basis is NON_AFFINE and fails closed', () => {
    const c = calib({ origin: rect(0, 0, 1, 1), basisX: { x: 100, y: 40 }, basisY: { x: 0, y: 100 } })
    expect(c.decision).toBe('NON_AFFINE')
    expect(c.affineVerified).toBe(false)
    expect(viewportRectToPaintLayerLocalV1(rect(0, 0, 10, 10), c)).toBeNull()
  })

  it('a zero basis fails closed as ZERO_BASIS', () => {
    const c = calib({ origin: rect(0, 0, 1, 1), basisX: { x: 0, y: 0 }, basisY: { x: 0, y: 100 } })
    expect(c.decision).toBe('ZERO_BASIS')
  })
})

describe('TRAE §7 — affine inverse mapping + round trip', () => {
  it('maps VIEWPORT → PAINT_LAYER_LOCAL with (viewport - origin) / scale', () => {
    const c = calib({ origin: rect(60, 0, 61, 1), basisX: { x: 150, y: 0 }, basisY: { x: 0, y: 150 } })
    const local = viewportRectToPaintLayerLocalV1(rect(60, 300, 660, 348), c)
    expect(local).not.toBeNull()
    expect(local!.left).toBeCloseTo(0, 6)
    expect(local!.top).toBeCloseTo(200, 6)
    expect(local!.width).toBeCloseTo(400, 6)
    expect(local!.height).toBeCloseTo(32, 6)
  })

  it('VIEWPORT → LOCAL → VIEWPORT round trip stays within 1px', () => {
    const c = calib({ origin: rect(60, 0, 61, 1), basisX: { x: 120, y: 0 }, basisY: { x: 0, y: 110 } })
    const source = rect(60, 421, 700, 454)
    const { maxDriftPx } = roundTripPaintLayerRectV1(source, c)
    expect(maxDriftPx).toBeLessThanOrEqual(1)
  })

  it('a scaleX != 1 AND scaleY != 1 layer still closes', () => {
    const c = calib({ origin: rect(60, 0, 61, 1), basisX: { x: 175, y: 0 }, basisY: { x: 0, y: 130 } })
    const source = rect(60, 421, 700, 454)
    const local = viewportRectToPaintLayerLocalV1(source, c)!
    const back = paintLayerLocalRectToViewportV1(local, c)!
    const drift = computeFragmentDrift(source, back)
    expect(drift.maxDriftPx).toBeLessThanOrEqual(1)
  })

  it('a NEGATIVE layer origin still closes', () => {
    const c = calib({ origin: rect(-40, -25, -39, -24), basisX: { x: 100, y: 0 }, basisY: { x: 0, y: 100 } })
    expect(c.decision).toBe('VERIFIED')
    const source = rect(60, 421, 700, 454)
    const local = viewportRectToPaintLayerLocalV1(source, c)!
    const back = paintLayerLocalRectToViewportV1(local, c)!
    expect(computeFragmentDrift(source, back).maxDriftPx).toBeLessThanOrEqual(1)
  })
})

describe('TRAE §14/§17 — the fragment drift + closure entry', () => {
  it('computes per-edge drift and max drift', () => {
    const d = computeFragmentDrift(rect(0, 0, 10, 10), rect(1, 0.5, 10.5, 10.25))
    expect(d.driftLeft).toBeCloseTo(1, 6)
    expect(d.driftTop).toBeCloseTo(0.5, 6)
    expect(d.driftRight).toBeCloseTo(0.5, 6)
    expect(d.driftBottom).toBeCloseTo(0.25, 6)
    expect(d.maxDriftPx).toBeCloseTo(1, 6)
  })

  it('a missing painted rect → Infinity drift → FAIL', () => {
    const d = computeFragmentDrift(rect(0, 0, 10, 10), null)
    expect(Number.isFinite(d.maxDriftPx)).toBe(false)
    const e = evaluateFragmentClosureEntry({ index: 0, sourceViewportRect: rect(0, 0, 10, 10), paintLayerLocalRect: null, paintedViewportRect: null, connected: true, visible: true })
    expect(e.decision).toBe('FAIL')
  })

  it('a PASS entry needs connected + visible + drift <= 1px', () => {
    const src = rect(0, 0, 10, 10)
    const ok = evaluateFragmentClosureEntry({ index: 0, sourceViewportRect: src, paintLayerLocalRect: null, paintedViewportRect: rect(0.4, 0, 10, 10.4), connected: true, visible: true })
    expect(ok.decision).toBe('PASS')
    const hidden = evaluateFragmentClosureEntry({ index: 0, sourceViewportRect: src, paintLayerLocalRect: null, paintedViewportRect: rect(0, 0, 10, 10), connected: true, visible: false })
    expect(hidden.decision).toBe('FAIL')
  })

  it('maxFragmentDrift is Infinity for an empty set', () => {
    expect(Number.isFinite(maxFragmentDrift([]))).toBe(false)
  })
})

describe('TRAE §18/§26/§27 — gates + current-transaction separation', () => {
  it('every fatal paint-layer gate starts at 0 and a single hit FAILs', () => {
    const c = createPaintLayerGeometryGates()
    expect(evaluatePaintLayerGeometryGates(c).decision).toBe('PASS')
    c.paintLayerCalibrationFail = 1
    expect(evaluatePaintLayerGeometryGates(c).decision).toBe('FAIL')
    expect(evaluatePaintLayerGeometryGates(c).failing).toEqual(['PAINT_LAYER_CALIBRATION_FAIL_COUNT'])
  })

  it('exposes the exact §18 gate labels', () => {
    expect(PAINT_LAYER_GEOMETRY_GATE_KEYS).toHaveLength(11)
    expect(PAINT_LAYER_GEOMETRY_GATE_LABELS.blankRowFragmentDriftGt1px).toBe('BLANK_ROW_FRAGMENT_DRIFT_GT_1PX_COUNT')
    expect(PAINT_LAYER_GEOMETRY_GATE_LABELS.verifiedRenderedRowsLegacyGeometryVeto).toBe('VERIFIED_RENDERED_ROWS_LEGACY_GEOMETRY_VETO_COUNT')
    const c = createPaintLayerGeometryGates()
    expect(formatPaintLayerGeometryGateReport(c)).toHaveLength(11)
    expect(c.blankRowFragmentDriftGt1px).toBe(0)
  })

  it('separates the CURRENT-TRANSACTION gates from the HISTORICAL coverage', () => {
    expect(BLANK_ROW_TX_GATE_KEYS).toHaveLength(4)
    expect(BLANK_ROW_TX_GATE_LABELS.currentTxPanelIntersectionCount).toBe('CURRENT_TX_PANEL_INTERSECTION_COUNT')
    expect(BLANK_ROW_HISTORICAL_COVERAGE_LABELS.historicalPanelIntersectionCount).toBe('HISTORICAL_PANEL_INTERSECTION_COUNT')
    const tx = createBlankRowTxGates()
    expect(evaluateBlankRowTxGates(tx).decision).toBe('PASS')
    tx.currentTxNavigatorIntersectionCount = 1
    expect(evaluateBlankRowTxGates(tx).decision).toBe('FAIL')
    expect(evaluateBlankRowTxGates(tx).failing).toEqual(['CURRENT_TX_NAVIGATOR_INTERSECTION_COUNT'])
    // the historical family is a DIFFERENT object with different labels.
    expect(Object.keys(BLANK_ROW_HISTORICAL_COVERAGE_LABELS)).not.toContain('currentTxPanelIntersectionCount')
  })
})

// ── §30 — the jsdom integration against a FAKE translated + scaled paint layer ─

const LAYER_ORIGIN_X = 60
const LAYER_ORIGIN_Y = 12
const LAYER_SCALE_X = 1.5
const LAYER_SCALE_Y = 1.25

/**
 * A fake paint layer: every descendant's getBoundingClientRect is computed from
 * its inline `left/top/width/height` through the simulated
 * `viewport = origin + scale * local` transform — a REAL translated + scaled
 * layer (not another copy of the production math).
 */
function installFakePaintLayer(): void {
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element) {
    const el = this as HTMLElement
    const l = Number.parseFloat(el.style.left)
    const t = Number.parseFloat(el.style.top)
    const w = Number.parseFloat(el.style.width)
    const h = Number.parseFloat(el.style.height)
    if (![l, t, w, h].every(Number.isFinite)) {
      return { x: 0, y: 0, left: 0, top: 0, right: 0, bottom: 0, width: 0, height: 0, toJSON: () => ({}) } as DOMRect
    }
    const left = LAYER_ORIGIN_X + LAYER_SCALE_X * l
    const top = LAYER_ORIGIN_Y + LAYER_SCALE_Y * t
    const right = LAYER_ORIGIN_X + LAYER_SCALE_X * (l + w)
    const bottom = LAYER_ORIGIN_Y + LAYER_SCALE_Y * (t + h)
    return { x: left, y: top, left, top, right, bottom, width: right - left, height: bottom - top, toJSON: () => ({}) } as DOMRect
  })
}

describe('TRAE §30 — jsdom fragment closure on a translated + scaled paint layer', () => {
  beforeEach(() => { installFakePaintLayer() })

  it('calibrates the real layer origin + scale and removes the probes', () => {
    const layer = document.createElement('div')
    layer.style.cssText = 'position:absolute;left:0;top:0;width:0;height:0;'
    document.body.appendChild(layer)
    const c = calibratePaintLayerFromLayer(layer, 7)
    expect(c.decision).toBe('VERIFIED')
    expect(c.originViewportX).toBeCloseTo(LAYER_ORIGIN_X, 6)
    expect(c.originViewportY).toBeCloseTo(LAYER_ORIGIN_Y, 6)
    expect(c.scaleX).toBeCloseTo(LAYER_SCALE_X, 6)
    expect(c.scaleY).toBeCloseTo(LAYER_SCALE_Y, 6)
    expect(c.affineVerified).toBe(true)
    // the probes must NOT survive the measurement.
    expect(layer.querySelectorAll('[data-inkchapter-diagnostic-calibration]').length).toBe(0)
  })

  it('paints 3 fragment-sized divs and re-measures painted viewport ≈ source viewport', () => {
    const layer = document.createElement('div')
    layer.style.cssText = 'position:absolute;left:0;top:0;width:0;height:0;'
    document.body.appendChild(layer)
    const c = calibratePaintLayerFromLayer(layer, 7)
    // source blank-row viewport rects (the fake transform's outputs for 3 rows).
    const sourceRows = [rect(60, 421, 700, 454), rect(60, 454, 700, 487), rect(60, 487, 700, 519)]
    const painted: RectLike[] = []
    for (const src of sourceRows) {
      const local = viewportRectToPaintLayerLocalV1(src, c)!
      const el = document.createElement('div')
      el.style.cssText = `position:absolute;left:${local.left}px;top:${local.top}px;width:${local.width}px;height:${local.height}px;`
      layer.appendChild(el)
      const r = el.getBoundingClientRect()
      painted.push(rect(r.left, r.top, r.right, r.bottom))
    }
    for (let i = 0; i < sourceRows.length; i++) {
      const drift = computeFragmentDrift(sourceRows[i], painted[i])
      expect(drift.maxDriftPx).toBeLessThanOrEqual(BLANK_ROW_FRAGMENT_MAX_DRIFT_PX)
    }
    // audit event names are the ones the real runtime emits.
    expect(PAINT_LAYER_CALIBRATION_AUDIT_EVENT).toBe('DOCUMENT-DIAGNOSTIC-PAINT-LAYER-CALIBRATION-AUDIT')
    expect(BLANK_ROW_FRAGMENT_CLOSURE_AUDIT_EVENT).toBe('DOCUMENT-DIAGNOSTIC-BLANK-ROW-FRAGMENT-CLOSURE-AUDIT')
  })
})
