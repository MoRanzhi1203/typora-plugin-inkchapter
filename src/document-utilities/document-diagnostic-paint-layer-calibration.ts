/**
 * TRAE §3–§7 / §13–§18 — PAINT LAYER COORDINATE AUTHORITY.
 *
 * The previous round ASSUMED `DOCUMENT_LOCAL = VIEWPORT - contentHostRect` and
 * never proved it on the live Typora paint layer. This module replaces that
 * assumption with a MEASURED calibration of the REAL layer the fragments are
 * painted into.
 *
 * Responsibilities (ONLY these two):
 *   - calibrate the paint layer's viewport origin + basis + scale
 *   - map Viewport Rect ↔ Paint-Layer Local Rect
 *
 * It NEVER carries diagnostic state, an active lease, a Drawer, a selection or
 * any business rule. Pure math + one tiny DOM probe helper; no host state.
 */

import type { RectLike } from './document-diagnostic-rendered-blank-row'

// ── §16/§17 — the runtime audit events ──────────────────────────────────────

/** §16 — the paint-layer calibration audit. */
export const PAINT_LAYER_CALIBRATION_AUDIT_EVENT = 'DOCUMENT-DIAGNOSTIC-PAINT-LAYER-CALIBRATION-AUDIT'

/** §17 — the painted-fragment closure audit (source vs painted viewport rect). */
export const BLANK_ROW_FRAGMENT_CLOSURE_AUDIT_EVENT = 'DOCUMENT-DIAGNOSTIC-BLANK-ROW-FRAGMENT-CLOSURE-AUDIT'

/** §4/§5 — the calibration probe marker (removed right after measuring). */
export const PAINT_LAYER_CALIBRATION_PROBE_ATTR = 'data-inkchapter-diagnostic-calibration'

/** §5 — the local X/Y distance between the origin probe and the basis probes. */
export const PAINT_LAYER_PROBE_DISTANCE_PX = 100

/** §5 — an axis-aligned layer may still carry sub-pixel skew; above this it is NON_AFFINE. */
export const PAINT_LAYER_AXIS_ALIGN_TOLERANCE_PX = 0.5

/** §7 — a scale at or below this is a degenerate (zero) basis → fail-closed. */
export const PAINT_LAYER_MIN_SCALE = 0.01

/** §14 — the ONE fixed fragment closure drift gate (never widened per-run). */
export const BLANK_ROW_FRAGMENT_MAX_DRIFT_PX = 1

// ── §6 — the calibration model ──────────────────────────────────────────────

export type PaintLayerCalibrationDecision =
  | 'VERIFIED'
  | 'LAYER_MISSING'
  | 'PROBE_MISSING'
  | 'ZERO_BASIS'
  | 'NON_AFFINE'
  | 'STALE_LAYOUT'

export interface PaintLayerCalibration {
  layoutEpoch: number

  originViewportX: number
  originViewportY: number

  basisX: { x: number; y: number }
  basisY: { x: number; y: number }

  scaleX: number
  scaleY: number

  affineVerified: boolean
  axisAligned: boolean

  layerConnected: boolean
  layerRect: RectLike | null

  originProbeViewportRect: RectLike | null
  xProbeViewportRect: RectLike | null
  yProbeViewportRect: RectLike | null

  decision: PaintLayerCalibrationDecision
  reason: string
}

function finiteRect(r: RectLike | null | undefined): r is RectLike {
  return r != null && Number.isFinite(r.left) && Number.isFinite(r.top)
    && Number.isFinite(r.right) && Number.isFinite(r.bottom)
}

/**
 * §6/§7 — derive the calibration from the THREE measured probe viewport rects.
 * Pure: the caller inserts/measures/removes the probes.
 */
export function derivePaintLayerCalibration(input: {
  layoutEpoch: number
  layerConnected: boolean
  layerRect: RectLike | null
  originProbeViewportRect: RectLike | null
  xProbeViewportRect: RectLike | null
  yProbeViewportRect: RectLike | null
  probeDistancePx?: number
}): PaintLayerCalibration {
  const distance = input.probeDistancePx ?? PAINT_LAYER_PROBE_DISTANCE_PX
  const p0 = input.originProbeViewportRect
  const px = input.xProbeViewportRect
  const py = input.yProbeViewportRect
  const base: PaintLayerCalibration = {
    layoutEpoch: input.layoutEpoch,
    originViewportX: finiteRect(p0) ? p0.left : Number.NaN,
    originViewportY: finiteRect(p0) ? p0.top : Number.NaN,
    basisX: { x: Number.NaN, y: Number.NaN },
    basisY: { x: Number.NaN, y: Number.NaN },
    scaleX: Number.NaN,
    scaleY: Number.NaN,
    affineVerified: false,
    axisAligned: false,
    layerConnected: input.layerConnected,
    layerRect: input.layerRect,
    originProbeViewportRect: p0,
    xProbeViewportRect: px,
    yProbeViewportRect: py,
    decision: 'PROBE_MISSING',
    reason: 'CALIBRATION_INCOMPLETE',
  }
  if (!input.layerConnected || input.layerRect == null) {
    return { ...base, decision: 'LAYER_MISSING', reason: 'PAINT_LAYER_NOT_CONNECTED' }
  }
  if (!finiteRect(p0) || !finiteRect(px) || !finiteRect(py)) {
    return { ...base, decision: 'PROBE_MISSING', reason: 'CALIBRATION_PROBE_NOT_MEASURED' }
  }
  const basisX = { x: px.left - p0.left, y: px.top - p0.top }
  const basisY = { x: py.left - p0.left, y: py.top - p0.top }
  const scaleX = basisX.x / distance
  const scaleY = basisY.y / distance
  const zeroBasis = !Number.isFinite(scaleX) || !Number.isFinite(scaleY)
    || scaleX <= PAINT_LAYER_MIN_SCALE || scaleY <= PAINT_LAYER_MIN_SCALE
  const axisAligned = Math.abs(basisX.y) <= PAINT_LAYER_AXIS_ALIGN_TOLERANCE_PX
    && Math.abs(basisY.x) <= PAINT_LAYER_AXIS_ALIGN_TOLERANCE_PX
  const affineVerified = !zeroBasis && axisAligned
  const decision: PaintLayerCalibrationDecision = zeroBasis
    ? 'ZERO_BASIS'
    : affineVerified ? 'VERIFIED' : 'NON_AFFINE'
  return {
    ...base,
    originViewportX: p0.left,
    originViewportY: p0.top,
    basisX,
    basisY,
    scaleX,
    scaleY,
    affineVerified,
    axisAligned,
    layerConnected: true,
    decision,
    reason: decision === 'VERIFIED'
      ? 'PAINT_LAYER_AFFINE_CALIBRATED'
      : decision === 'ZERO_BASIS' ? 'PAINT_LAYER_ZERO_BASIS' : 'PAINT_LAYER_NON_AFFINE_TRANSFORM',
  }
}

// ── §7 — the Viewport ↔ Paint-Layer Local mapping ───────────────────────────

/** §7 — `PAINT_LAYER_LOCAL = (VIEWPORT - origin) / scale`. Fail-closed on a non-affine layer. */
export function viewportRectToPaintLayerLocalV1(
  rect: RectLike,
  calibration: PaintLayerCalibration,
): RectLike | null {
  if (calibration.decision !== 'VERIFIED' || !calibration.affineVerified) return null
  const { originViewportX, originViewportY, scaleX, scaleY } = calibration
  if (!(scaleX > 0) || !(scaleY > 0)) return null
  if (!finiteRect(rect)) return null
  const left = (rect.left - originViewportX) / scaleX
  const top = (rect.top - originViewportY) / scaleY
  const right = (rect.right - originViewportX) / scaleX
  const bottom = (rect.bottom - originViewportY) / scaleY
  return { left, top, right, bottom, width: right - left, height: bottom - top }
}

/** §7 — the exact inverse, used to reproject a local rect for evidence. */
export function paintLayerLocalRectToViewportV1(
  rect: RectLike,
  calibration: PaintLayerCalibration,
): RectLike | null {
  if (calibration.decision !== 'VERIFIED' || !calibration.affineVerified) return null
  const { originViewportX, originViewportY, scaleX, scaleY } = calibration
  if (!(scaleX > 0) || !(scaleY > 0)) return null
  const left = rect.left * scaleX + originViewportX
  const top = rect.top * scaleY + originViewportY
  const right = rect.right * scaleX + originViewportX
  const bottom = rect.bottom * scaleY + originViewportY
  return { left, top, right, bottom, width: right - left, height: bottom - top }
}

/** §29 — VIEWPORT → PAINT_LOCAL → VIEWPORT; the round trip must stay within 1px. */
export function roundTripPaintLayerRectV1(
  rect: RectLike,
  calibration: PaintLayerCalibration,
): { local: RectLike | null; viewport: RectLike | null; maxDriftPx: number } {
  const local = viewportRectToPaintLayerLocalV1(rect, calibration)
  const viewport = local ? paintLayerLocalRectToViewportV1(local, calibration) : null
  if (!local || !viewport) return { local, viewport, maxDriftPx: Number.POSITIVE_INFINITY }
  const maxDriftPx = Math.max(
    Math.abs(viewport.left - rect.left),
    Math.abs(viewport.top - rect.top),
    Math.abs(viewport.right - rect.right),
    Math.abs(viewport.bottom - rect.bottom),
  )
  return { local, viewport, maxDriftPx }
}

// ── §13/§14/§17 — the painted-fragment closure ──────────────────────────────

export interface FragmentDrift {
  driftLeft: number
  driftTop: number
  driftRight: number
  driftBottom: number
  maxDriftPx: number
}

/** §14 — the per-edge absolute drift of one painted fragment vs its source row. */
export function computeFragmentDrift(
  source: RectLike | null,
  painted: RectLike | null,
): FragmentDrift {
  if (!finiteRect(source) || !finiteRect(painted)) {
    return { driftLeft: Number.POSITIVE_INFINITY, driftTop: Number.POSITIVE_INFINITY, driftRight: Number.POSITIVE_INFINITY, driftBottom: Number.POSITIVE_INFINITY, maxDriftPx: Number.POSITIVE_INFINITY }
  }
  const driftLeft = Math.abs(source.left - painted.left)
  const driftTop = Math.abs(source.top - painted.top)
  const driftRight = Math.abs(source.right - painted.right)
  const driftBottom = Math.abs(source.bottom - painted.bottom)
  return {
    driftLeft,
    driftTop,
    driftRight,
    driftBottom,
    maxDriftPx: Math.max(driftLeft, driftTop, driftRight, driftBottom),
  }
}

export interface BlankRowFragmentClosureEntry {
  index: number
  sourceViewportRect: RectLike | null
  paintLayerLocalRect: RectLike | null
  paintedViewportRect: RectLike | null
  driftLeft: number
  driftTop: number
  driftRight: number
  driftBottom: number
  maxDriftPx: number
  connected: boolean
  visible: boolean
  decision: 'PASS' | 'FAIL'
}

/** §14 — a fragment PASSES iff connected + visible + measured + drift <= 1px. */
export function evaluateFragmentClosureEntry(input: {
  index: number
  sourceViewportRect: RectLike | null
  paintLayerLocalRect: RectLike | null
  paintedViewportRect: RectLike | null
  connected: boolean
  visible: boolean
}): BlankRowFragmentClosureEntry {
  const drift = computeFragmentDrift(input.sourceViewportRect, input.paintedViewportRect)
  const ok = input.connected
    && input.visible
    && finiteRect(input.paintedViewportRect)
    && Number.isFinite(drift.maxDriftPx)
    && drift.maxDriftPx <= BLANK_ROW_FRAGMENT_MAX_DRIFT_PX
  return {
    index: input.index,
    sourceViewportRect: input.sourceViewportRect,
    paintLayerLocalRect: input.paintLayerLocalRect,
    paintedViewportRect: input.paintedViewportRect,
    driftLeft: drift.driftLeft,
    driftTop: drift.driftTop,
    driftRight: drift.driftRight,
    driftBottom: drift.driftBottom,
    maxDriftPx: drift.maxDriftPx,
    connected: input.connected,
    visible: input.visible,
    decision: ok ? 'PASS' : 'FAIL',
  }
}

/** §14 — the worst-case drift across every fragment (Infinity when none / unusable). */
export function maxFragmentDrift(entries: ReadonlyArray<BlankRowFragmentClosureEntry>): number {
  if (entries.length === 0) return Number.POSITIVE_INFINITY
  return Math.max(...entries.map(e => e.maxDriftPx))
}

// ── §18 — the new FATAL gate family (all must stay 0) ───────────────────────

export const PAINT_LAYER_GEOMETRY_GATE_KEYS = [
  'paintLayerCalibrationFail',
  'paintLayerNonAffine',
  'paintLayerStaleEpoch',
  'blankRowFragmentCountMismatch',
  'blankRowFragmentDisconnected',
  'blankRowFragmentNotVisible',
  'blankRowFragmentDriftGt1px',
  'blankRowFragmentPreviousIntersection',
  'blankRowFragmentNextIntersection',
  'blankRowFragmentCaptionIntersection',
  'verifiedRenderedRowsLegacyGeometryVeto',
] as const

export type PaintLayerGeometryGateKey = typeof PAINT_LAYER_GEOMETRY_GATE_KEYS[number]

export const PAINT_LAYER_GEOMETRY_GATE_LABELS: Record<PaintLayerGeometryGateKey, string> = {
  paintLayerCalibrationFail: 'PAINT_LAYER_CALIBRATION_FAIL_COUNT',
  paintLayerNonAffine: 'PAINT_LAYER_NON_AFFINE_COUNT',
  paintLayerStaleEpoch: 'PAINT_LAYER_STALE_EPOCH_COUNT',
  blankRowFragmentCountMismatch: 'BLANK_ROW_FRAGMENT_COUNT_MISMATCH_COUNT',
  blankRowFragmentDisconnected: 'BLANK_ROW_FRAGMENT_DISCONNECTED_COUNT',
  blankRowFragmentNotVisible: 'BLANK_ROW_FRAGMENT_NOT_VISIBLE_COUNT',
  blankRowFragmentDriftGt1px: 'BLANK_ROW_FRAGMENT_DRIFT_GT_1PX_COUNT',
  blankRowFragmentPreviousIntersection: 'BLANK_ROW_FRAGMENT_PREVIOUS_INTERSECTION_COUNT',
  blankRowFragmentNextIntersection: 'BLANK_ROW_FRAGMENT_NEXT_INTERSECTION_COUNT',
  blankRowFragmentCaptionIntersection: 'BLANK_ROW_FRAGMENT_CAPTION_INTERSECTION_COUNT',
  verifiedRenderedRowsLegacyGeometryVeto: 'VERIFIED_RENDERED_ROWS_LEGACY_GEOMETRY_VETO_COUNT',
}

export function createPaintLayerGeometryGates(): Record<PaintLayerGeometryGateKey, number> {
  const out = {} as Record<PaintLayerGeometryGateKey, number>
  for (const k of PAINT_LAYER_GEOMETRY_GATE_KEYS) out[k] = 0
  return out
}

export function formatPaintLayerGeometryGateReport(counters: Readonly<Record<string, number>>): string[] {
  return PAINT_LAYER_GEOMETRY_GATE_KEYS.map(k => `${PAINT_LAYER_GEOMETRY_GATE_LABELS[k]}=${counters[k] ?? 0}`)
}

export function evaluatePaintLayerGeometryGates(
  counters: Readonly<Record<string, number>>,
): { decision: 'PASS' | 'FAIL'; failCount: number; failing: string[] } {
  const failing = PAINT_LAYER_GEOMETRY_GATE_KEYS.filter(k => (counters[k] ?? 0) !== 0)
  return {
    decision: failing.length === 0 ? 'PASS' : 'FAIL',
    failCount: failing.length,
    failing: failing.map(k => PAINT_LAYER_GEOMETRY_GATE_LABELS[k]),
  }
}

// ── §26/§27 — the CURRENT-TRANSACTION-scoped panel / navigator / toolbar gates ─
//
// These are SEPARATE from the historical coverage counters. Only the fragments of
// the CURRENT transaction can fail it; any earlier heading / document-end /
// code-block visual counter is HISTORICAL and can never poison this transaction.

export const BLANK_ROW_TX_GATE_KEYS = [
  'currentTxPanelIntersectionCount',
  'currentTxNavigatorIntersectionCount',
  'currentTxToolbarIntersectionCount',
  'currentTxSafeClipMutationCount',
] as const

export type BlankRowTxGateKey = typeof BLANK_ROW_TX_GATE_KEYS[number]

export const BLANK_ROW_TX_GATE_LABELS: Record<BlankRowTxGateKey, string> = {
  currentTxPanelIntersectionCount: 'CURRENT_TX_PANEL_INTERSECTION_COUNT',
  currentTxNavigatorIntersectionCount: 'CURRENT_TX_NAVIGATOR_INTERSECTION_COUNT',
  currentTxToolbarIntersectionCount: 'CURRENT_TX_TOOLBAR_INTERSECTION_COUNT',
  currentTxSafeClipMutationCount: 'CURRENT_TX_SAFE_CLIP_MUTATION_COUNT',
}

/**
 * §26 — the HISTORICAL coverage counters. They are POSITIVE evidence only and can
 * never fail a transaction; they are kept apart from the current-tx fatal family.
 */
export const BLANK_ROW_HISTORICAL_COVERAGE_LABELS: Readonly<Record<string, string>> = {
  historicalPanelIntersectionCount: 'HISTORICAL_PANEL_INTERSECTION_COUNT',
  historicalNavigatorIntersectionCount: 'HISTORICAL_NAVIGATOR_INTERSECTION_COUNT',
  historicalToolbarIntersectionCount: 'HISTORICAL_TOOLBAR_INTERSECTION_COUNT',
  historicalSafeClipMutationCount: 'HISTORICAL_SAFE_CLIP_MUTATION_COUNT',
}

export function createBlankRowTxGates(): Record<BlankRowTxGateKey, number> {
  const out = {} as Record<BlankRowTxGateKey, number>
  for (const k of BLANK_ROW_TX_GATE_KEYS) out[k] = 0
  return out
}

export function formatBlankRowTxGateReport(counters: Readonly<Record<string, number>>): string[] {
  return BLANK_ROW_TX_GATE_KEYS.map(k => `${BLANK_ROW_TX_GATE_LABELS[k]}=${counters[k] ?? 0}`)
}

export function evaluateBlankRowTxGates(
  counters: Readonly<Record<string, number>>,
): { decision: 'PASS' | 'FAIL'; failCount: number; failing: string[] } {
  const failing = BLANK_ROW_TX_GATE_KEYS.filter(k => (counters[k] ?? 0) !== 0)
  return {
    decision: failing.length === 0 ? 'PASS' : 'FAIL',
    failCount: failing.length,
    failing: failing.map(k => BLANK_ROW_TX_GATE_LABELS[k]),
  }
}

// ── §4/§5 — the DOM probe helper (real layer, removed immediately) ───────────

function defaultMeasure(el: HTMLElement): RectLike | null {
  try {
    const r = el.getBoundingClientRect()
    if (!Number.isFinite(r.left) || !Number.isFinite(r.top)) return null
    return { left: r.left, top: r.top, right: r.right, bottom: r.bottom, width: r.right - r.left, height: r.bottom - r.top }
  } catch {
    return null
  }
}

/**
 * §4/§5 — insert three invisible plugin-owned probes into `layer` at local
 * (0,0) / (100,0) / (0,100), measure them, then REMOVE them and derive the
 * calibration. The probes share the EXACT containing block of the fragments, so
 * the measured origin/basis is the REAL paint-layer transform.
 */
export function calibratePaintLayerFromLayer(
  layer: HTMLElement | null,
  layoutEpoch: number,
  measure: (el: HTMLElement) => RectLike | null = defaultMeasure,
  probeDistancePx: number = PAINT_LAYER_PROBE_DISTANCE_PX,
): PaintLayerCalibration {
  const layerRect = layer ? measure(layer) : null
  if (layer == null || !layer.isConnected) {
    return derivePaintLayerCalibration({
      layoutEpoch, layerConnected: false, layerRect,
      originProbeViewportRect: null, xProbeViewportRect: null, yProbeViewportRect: null, probeDistancePx,
    })
  }
  const probes: HTMLElement[] = []
  const makeProbe = (left: number, top: number): HTMLElement => {
    const el = document.createElement('div')
    el.setAttribute(PAINT_LAYER_CALIBRATION_PROBE_ATTR, `${left},${top}`)
    el.style.cssText = `position:absolute;left:${left}px;top:${top}px;width:1px;height:1px;`
      + 'visibility:hidden;pointer-events:none;'
    layer.appendChild(el)
    probes.push(el)
    return el
  }
  try {
    const p0 = makeProbe(0, 0)
    const px = makeProbe(probeDistancePx, 0)
    const py = makeProbe(0, probeDistancePx)
    return derivePaintLayerCalibration({
      layoutEpoch,
      layerConnected: true,
      layerRect,
      originProbeViewportRect: measure(p0),
      xProbeViewportRect: measure(px),
      yProbeViewportRect: measure(py),
      probeDistancePx,
    })
  } finally {
    for (const el of probes) {
      try { el.remove() } catch { /* noop */ }
    }
  }
}
