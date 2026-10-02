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

// V5.14-R5 §3/§4/§5/§7 — the ONE DiagnosticCode -> inlineHint authority.
import { inlineHintCategoryForCode, inlineHintIsSafe, resolveInlineHint } from './document-diagnostic-inline-presentation-v514-r5'
import {
  HEADING_REASON_CHIP_PREFERRED_GAP_PX_V2,
  computeHeadingReasonChipPlacement as computeCanonicalHeadingReasonChipPlacement,
} from './document-diagnostic-heading-reason-chip-stability-v2'

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

/**
 * §12/§29 — overlay placement。**Heading Reason Chip Stable Anchor V2 重写**：
 * 现在是一个 thin adapter，唯一 authority 是
 * `computeHeadingReasonChipPlacement`（`document-diagnostic-heading-reason-chip-stability-v2.ts`）。
 *
 * ROOT_V2_A —— 旧实现横向空间不足时返回 `BELOW_LAST_LINE`（`top = last.bottom + 4`、
 * `left` 可退化为 0）。该 next-line fallback 已被**结构性移除**：chip 恒为
 * `INLINE_RIGHT`，只做水平 clamp，且 `left >= last.right + 4px` 永成立。
 */
export function computeHeadingReasonChipPlacement(input: ReasonChipPlacementInput): ReasonChipPlacement | null {
  if (input.contentRects.length === 0) return null
  const last = input.contentRects[input.contentRects.length - 1]
  // §11 — Drawer 只作为“遮挡事实”收窄安全右界；它**永不**把安全右界压到 chip 宽度以下，
  // 也不会把 chip 推到文字左侧（V2 canonical 内含结构下限）。
  const safeRight = input.drawerLeft != null
    ? Math.max(input.drawerLeft, last.right + HEADING_REASON_CHIP_PREFERRED_GAP_PX_V2)
    : input.editorRight
  const placement = computeCanonicalHeadingReasonChipPlacement({
    lastTextRect: last,
    headingRect: null,
    chipWidth: input.chipWidth,
    chipHeight: input.chipHeight,
    editorSafeRect: {
      left: input.editorLeft,
      top: last.top,
      right: safeRight,
      bottom: last.bottom,
    },
    preferredGapPx: HEADING_REASON_CHIP_PREFERRED_GAP_PX_V2,
  })
  return {
    rect: makeHeadingRect({
      left: placement.left,
      top: placement.top,
      right: placement.left + input.chipWidth,
      bottom: placement.top + input.chipHeight,
    }),
    // 恒为同行右侧；`BELOW_LAST_LINE` 不再可能产生。
    placement: 'RIGHT_OF_LAST_LINE',
    clamped: placement.horizontalClampApplied,
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

/**
 * V1 §2/§9/§10 — the diagnostic presentation SCOPE. Scope is a SEPARATE axis
 * from severity: a `hint` may be document-level (heading-only) or object-local
 * ("code block missing language"), and only scope decides reason-chip policy.
 */
export type DiagnosticPresentationScope = 'document' | 'heading' | 'block' | 'object' | 'inline'

/**
 * V1 §10/§25 — the ONE reason-chip presentation authority.
 *
 * Chip visibility is decided by diagnostic SCOPE / explicit presentation
 * metadata — NEVER by severity. §9 explicitly forbids a global
 * `severity === 'hint' → hideReasonChip()` rule, because object-local hints
 * (code block missing language, figure missing caption, …) legitimately keep
 * their short chip.
 *
 * Priority (highest first):
 *   1. explicit `metadata.reasonChip` boolean override
 *   2. explicit scope (argument or `metadata.scope`): `'document'` ⇒ suppressed
 *   3. default ⇒ shown
 */
export function shouldRenderReasonChip(diagnostic: {
  scope?: DiagnosticPresentationScope | string | null
  metadata?: Record<string, unknown> | null
}): boolean {
  const meta = diagnostic.metadata ?? null
  const override = meta?.['reasonChip']
  if (override === false) return false
  if (override === true) return true
  const scope = diagnostic.scope ?? (meta?.['scope'] as string | null | undefined) ?? null
  if (String(scope ?? '').trim().toLowerCase() === 'document') return false
  return true
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

/**
 * §17 — a SHORT reason chip.
 *
 * V5.14-R5 §3/§4/§5/§7 — the inline text is GENERATED from the DiagnosticCode by
 * the ONE presentation authority (`document-diagnostic-inline-presentation-v514-r5`).
 * It is never a slice of the long diagnostic message (the previous fallback sliced
 * the strict validator's own `message`, which starts with `⚠ 严格模式结构错误：…`,
 * so the chip leaked both the severity glyph and a full sentence). An unmapped
 * code yields a short CATEGORY label instead.
 */
export function buildHeadingLocateReason(diagnostic: HeadingReasonFacts): string | null {
  const { hint, source } = resolveInlineHint({
    code: diagnostic.code,
    message: diagnostic.message,
    metadata: (diagnostic.metadata ?? {}) as Record<string, unknown>,
  })
  if (source === 'MESSAGE_FALLBACK') return inlineHintCategoryForCode(diagnostic.code)
  return inlineHintIsSafe(hint) ? hint : inlineHintCategoryForCode(diagnostic.code)
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
