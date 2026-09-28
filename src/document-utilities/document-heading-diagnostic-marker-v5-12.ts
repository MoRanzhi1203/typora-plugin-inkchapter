/**
 * Phase 7R.3.11.8B.25 — Heading Diagnostic In-Document Marker V5.12-R1 (pure
 * contract).
 *
 * This module only describes the MARKDOWN BODY marker for a real Heading that
 * carries a diagnostic. It never touches the "文档检测" Drawer item UI and never
 * re-derives any diagnostic business rule.
 *
 *   Level 1  Passive Severity Marker   icon + 2px severity rail (gutter only)
 *   Level 2  Active Heading Emphasis   text-tight tint fragments + keyline
 *   Level 3  Active Reason Chip        short "why" chip, overlay only
 *
 * Hard invariants:
 *   - the marker lives in the heading's LEFT GUTTER and never overlaps glyphs
 *     (`markerRight <= contentLeft - 4px`);
 *   - Passive state NEVER paints a full-width / block wash;
 *   - Active emphasis uses the VISIBLE heading content (numbering union text
 *     fragments), never the heading block width;
 *   - a multi-line heading paints one fragment per line (no big union rect).
 *
 * No DOM access, no host state.
 */

export const HEADING_MARKER_AUDIT_EVENT = 'DOCUMENT-DIAGNOSTIC-HEADING-MARKER-AUDIT'

/** §6 — recommended geometry (px). */
export const HEADING_MARKER_ICON_SIZE_PX = 13
export const HEADING_MARKER_RAIL_WIDTH_PX = 2
export const HEADING_MARKER_RAIL_ACTIVE_WIDTH_PX = 3
export const HEADING_MARKER_ICON_RAIL_GAP_PX = 6
export const HEADING_MARKER_PREFERRED_TEXT_GAP_PX = 7
/** §6 — HARD minimum gap between the marker and the heading content. */
export const HEADING_MARKER_MIN_TEXT_GAP_PX = 4
/** §9 — recommended active tint (6%~8%), never the pre-V5.3 20%+ wash. */
export const HEADING_ACTIVE_FILL_ALPHA = 0.07
export const HEADING_ACTIVE_FILL_ALPHA_MAX = 0.12
/** §11 — the reason chip stays short. */
export const HEADING_REASON_CHIP_MAX_CHARS = 18

export interface HeadingRect {
  x: number
  y: number
  left: number
  top: number
  right: number
  bottom: number
  width: number
  height: number
}

/** Every derived rect is fully rebuilt from its edges. */
export function makeHeadingRect(input: { left: number; top: number; right: number; bottom: number }): HeadingRect {
  const l = Number(input.left)
  const t = Number(input.top)
  const r = Math.max(l, Number(input.right))
  const b = Math.max(t, Number(input.bottom))
  return { x: l, y: t, left: l, top: t, right: r, bottom: b, width: r - l, height: b - t }
}

/** §14 — numbering rect ∪ visible text rect (read-only union, no DOM change). */
export function unionHeadingNumberAndTextRects(
  numberRect: HeadingRect | null,
  textRects: ReadonlyArray<HeadingRect>,
): HeadingRect | null {
  const all = [numberRect, ...textRects].filter((r): r is HeadingRect => r != null)
  if (all.length === 0) return null
  let left = all[0].left
  let top = all[0].top
  let right = all[0].right
  let bottom = all[0].bottom
  for (const r of all) {
    left = Math.min(left, r.left)
    top = Math.min(top, r.top)
    right = Math.max(right, r.right)
    bottom = Math.max(bottom, r.bottom)
  }
  return makeHeadingRect({ left, top, right, bottom })
}

export interface HeadingMarkerGeometryInput {
  /** Real heading semantic block rect (icon/rail vertical anchor only). */
  anchorRect: HeadingRect
  /** Visible heading content rect (numbering ∪ first-line text). */
  contentRect: HeadingRect
  /** Editor left edge — the marker must never cross it into the glyphs. */
  editorLeft: number
  /** The first line height (rail height = line height * ratio). */
  firstLineHeight: number
}

export interface HeadingMarkerGeometry {
  iconRect: HeadingRect | null
  railRect: HeadingRect
  markerRight: number
  markerLeft: number
  textGap: number
  compactFallback: boolean
  railOnlyFallback: boolean
}

/** §6/§28 — the gutter marker geometry. Never overlaps the heading glyphs. */
export function computeHeadingMarkerGeometry(input: HeadingMarkerGeometryInput): HeadingMarkerGeometry {
  const anchor = input.anchorRect
  const content = input.contentRect
  const railHeight = Math.max(8, Math.round(input.firstLineHeight * 0.7))
  const railTop = anchor.top + Math.max(0, (input.firstLineHeight - railHeight) / 2)
  const anchorBottom = Math.min(anchor.bottom, anchor.top + Math.max(input.firstLineHeight, railHeight))

  const railRight = content.left - HEADING_MARKER_PREFERRED_TEXT_GAP_PX
  const rail = makeHeadingRect({
    left: railRight - HEADING_MARKER_RAIL_WIDTH_PX,
    top: railTop,
    right: railRight,
    bottom: Math.min(railTop + railHeight, anchorBottom),
  })
  let iconRect: HeadingRect | null = makeHeadingRect({
    left: rail.left - HEADING_MARKER_ICON_RAIL_GAP_PX - HEADING_MARKER_ICON_SIZE_PX,
    top: railTop + (rail.height - HEADING_MARKER_ICON_SIZE_PX) / 2,
    right: rail.left - HEADING_MARKER_ICON_RAIL_GAP_PX,
    bottom: railTop + (rail.height - HEADING_MARKER_ICON_SIZE_PX) / 2 + HEADING_MARKER_ICON_SIZE_PX,
  })
  let compactFallback = false
  let railOnlyFallback = false
  // §28 — near the editor left edge: shorten icon→rail gap first, then keep
  // ONLY the rail. NEVER move the icon onto the text.
  const minLeft = Math.min(input.editorLeft, content.left)
  if (iconRect.left < minLeft) {
    compactFallback = true
    const gap = 2
    iconRect = makeHeadingRect({
      left: rail.left - gap - HEADING_MARKER_ICON_SIZE_PX,
      top: iconRect.top,
      right: rail.left - gap,
      bottom: iconRect.bottom,
    })
    if (iconRect.left < minLeft) {
      iconRect = null
      railOnlyFallback = true
    }
  }
  // The rail may never cross into the glyphs: clamp it to the hard gap.
  const hardRailRight = Math.min(rail.right, content.left - HEADING_MARKER_MIN_TEXT_GAP_PX)
  const clampedRail = hardRailRight < rail.right
    ? makeHeadingRect({ left: hardRailRight - HEADING_MARKER_RAIL_WIDTH_PX, top: rail.top, right: hardRailRight, bottom: rail.bottom })
    : rail
  const markerRight = clampedRail.right
  const markerLeft = iconRect ? Math.min(iconRect.left, clampedRail.left) : clampedRail.left
  return {
    iconRect,
    railRect: clampedRail,
    markerRight,
    markerLeft,
    textGap: content.left - markerRight,
    compactFallback,
    railOnlyFallback,
  }
}

export interface ReasonChipPlacementInput {
  /** The visible content fragments (bottom-most line drives the placement). */
  contentRects: ReadonlyArray<HeadingRect>
  chipWidth: number
  chipHeight: number
  /** Horizontal bounds the chip must stay inside. */
  editorLeft: number
  editorRight: number
  drawerLeft: number | null
}

export interface ReasonChipPlacement {
  rect: HeadingRect
  placement: 'RIGHT_OF_LAST_LINE' | 'BELOW_LAST_LINE'
  clamped: boolean
}

/** §12/§29 — overlay placement: right of the last line, else below it. */
export function computeHeadingReasonChipPlacement(input: ReasonChipPlacementInput): ReasonChipPlacement | null {
  if (input.contentRects.length === 0) return null
  const last = input.contentRects[input.contentRects.length - 1]
  const rightLimit = input.drawerLeft != null ? Math.min(input.editorRight, input.drawerLeft) : input.editorRight
  const gap = 8
  const rightOf = last.right + gap
  if (rightOf + input.chipWidth <= rightLimit) {
    return {
      rect: makeHeadingRect({ left: rightOf, top: last.top, right: rightOf + input.chipWidth, bottom: last.top + input.chipHeight }),
      placement: 'RIGHT_OF_LAST_LINE',
      clamped: false,
    }
  }
  // §12 — below the last line with a small offset; never over the next body line.
  const belowTop = last.bottom + 4
  const left = Math.min(Math.max(input.editorLeft, last.left), Math.max(input.editorLeft, rightLimit - input.chipWidth))
  return {
    rect: makeHeadingRect({ left, top: belowTop, right: left + input.chipWidth, bottom: belowTop + input.chipHeight }),
    placement: 'BELOW_LAST_LINE',
    clamped: true,
  }
}

export type HeadingMarkerSeverity = 'error' | 'warning' | 'info'

export function severityRank(severity: string | null | undefined): number {
  const s = String(severity ?? '').toLowerCase()
  if (s === 'error') return 3
  if (s === 'warning') return 2
  if (s === 'info') return 1
  return 0
}

/** §19 — one marker per heading, severity = highest among its diagnostics. */
export function mergeHeadingMarkerSeverity(severities: ReadonlyArray<string | null | undefined>): HeadingMarkerSeverity | null {
  let best: HeadingMarkerSeverity | null = null
  let bestRank = 0
  for (const s of severities) {
    const rank = severityRank(s)
    if (rank > bestRank) {
      bestRank = rank
      best = rank === 3 ? 'error' : rank === 2 ? 'warning' : 'info'
    }
  }
  return best
}

/** §16 — level and severity are INDEPENDENT (never "H6 ⇒ error"). */
export function headingLevelLabel(level: number | null | undefined): string | null {
  const n = Number(level)
  if (!Number.isInteger(n) || n < 1 || n > 6) return null
  return `H${n}`
}

export interface HeadingReasonFacts {
  code: string
  message?: string | null
  metadata?: Record<string, unknown> | null
}

/** §17 — a SHORT reason chip, built only from existing diagnostic facts. */
export function buildHeadingLocateReason(diagnostic: HeadingReasonFacts): string | null {
  const meta = diagnostic.metadata ?? {}
  const code = diagnostic.code
  const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null)
  const prev = num(meta.previousLevel)
  const cur = num(meta.currentLevel)
  if (code === 'HEADING_LEVEL_GAP' && prev != null && cur != null) {
    const missing = Array.isArray(meta.missingLevels) ? (meta.missingLevels as unknown[]).map(n => num(n)).filter((n): n is number => n != null) : []
    const missLabel = missing.length > 0 ? missing.map(l => `H${l}`).join('、') : null
    return missLabel ? `H${prev} → H${cur} · 缺 ${missLabel}` : `H${prev} → H${cur}`
  }
  if (code === 'STRICT_SINGLE_H1_MULTIPLE_H1') return '多余 H1'
  if (code === 'STRICT_SINGLE_H1_NO_H1') return '缺少 H1'
  const reason = typeof meta.reason === 'string' ? meta.reason : null
  if (reason === 'H1_NOT_FIRST') return 'H1 未位于文首'
  if (code === 'HEADING_EMPTY_TEXT') return '空标题'
  if (code === 'HEADING_DUPLICATE_TEXT') return '重复标题文字'
  if (code === 'HEADING_DUPLICATE_IDENTITY') return '重复标题身份'
  if (code.startsWith('LATENT_ATX_HEADING_MARKER')) return '疑似未生效标题'
  // §17 — a structured-fact-free diagnostic falls back to a SHORT message slice.
  const msg = String(diagnostic.message ?? '').trim()
  if (!msg) return null
  const short = msg.length <= HEADING_REASON_CHIP_MAX_CHARS ? msg : `${msg.slice(0, HEADING_REASON_CHIP_MAX_CHARS - 1)}…`
  return short
}

/** §27 — passive marker dedupe key (one marker per heading element). */
export function headingMarkerIdentity(input: {
  stableIdentity: string | null | undefined
  line: number | null
  text: string
}): string {
  if (input.stableIdentity) return `id:${input.stableIdentity}`
  if (input.line != null) return `line:${input.line}`
  return `text:${input.text.trim().toLowerCase()}`
}

/** §35 — the hard counters (every one must stay 0). */
export const HEADING_MARKER_V512R1_GATE_KEYS = [
  'headingMarkerTextOverlap',
  'headingPassiveFullWidthWash',
  'headingPassiveBackgroundMutation',
  'headingActiveUsesFullBlockRect',
  'headingActiveFullWidthWash',
  'headingNumberingExcludedFromActiveContent',
  'headingMultilineUnionWash',
  'multipleHeadingMarkerOverlap',
  'headingReasonChipReflow',
  'headingReasonChipTextOverlap',
  'headingPostCommitScrollRepaint',
  'headingPostCommitScrollRemeasure',
  'headingPostCommitScrollReresolve',
  'headingScrollGeometryDrift',
  'headingDismissRemovesPassiveDiagnostic',
] as const

export type HeadingMarkerV512R1GateKey = typeof HEADING_MARKER_V512R1_GATE_KEYS[number]

export function createHeadingMarkerV512R1GateCounters(): Record<HeadingMarkerV512R1GateKey, number> {
  const out = {} as Record<HeadingMarkerV512R1GateKey, number>
  for (const key of HEADING_MARKER_V512R1_GATE_KEYS) out[key] = 0
  return out
}
