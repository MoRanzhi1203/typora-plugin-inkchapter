/**
 * InkChapter — workspace tab close ×  hover/focus-only visibility (V1).
 *
 * The VISIBILITY behaviour itself is pure CSS (authoritative block in
 * style.scss): close is hidden by default and only the hovered / focused tab's
 * own × becomes visible — active tabs get no permanent ×, and the close layout
 * slot is always reserved (opacity/visibility/pointer-events only, never
 * display:none). This module only:
 *   - keeps a single-mount enhancer counter (duplicate guard), and
 *   - evaluates / measures close-visibility + layout-stability facts for the
 *     runtime invariant `DOCUMENT-UTILITY-TAB-CLOSE-VISIBILITY-INVARIANT`.
 *
 * It adds NO listeners and never touches close handlers / save prompts / drag /
 * right-click / context-menu business.
 */
export const TAB_CLOSE_DEFAULT = { opacity: 0, visibility: 'hidden', pointerEvents: 'none' }

let tabCloseEnhancerInstanceCount = 0

export interface TabCloseLayoutStability {
  tabWidthDeltaPx: number | null
  titleWidthDeltaPx: number | null
  titleLeftDeltaPx: number | null
}

export interface TabCloseEvaluationParams {
  tabCount: number
  /** Index of the active tab (or -1 when none). */
  activeIndex: number
  /** Index under the mouse / keyboard focus (or -1 when none). */
  hoveredOrFocusedIndex: number
  /** Indices whose close is currently visible. */
  visibleIndices: number[]
  /** Hover (mouse) vs keyboard focus source of the current visibility. */
  origin: 'hover' | 'focus' | 'none'
  layout: TabCloseLayoutStability
}

export interface TabCloseEvaluationResult {
  visibleCloseCount: number
  otherVisibleCloseCount: number
  defaultStateOk: boolean
  hoverOrFocusStateOk: boolean
  layoutOk: boolean
  decision: 'PASS' | 'FAIL'
  reason: string
}

/** Pure decision logic (unit tested without a browser layout engine). */
export function evaluateTabCloseVisibility(params: TabCloseEvaluationParams): TabCloseEvaluationResult {
  const visibleCloseCount = params.visibleIndices.length
  const target = params.hoveredOrFocusedIndex
  const otherVisibleCloseCount = target >= 0
    ? params.visibleIndices.filter(i => i !== target).length
    : visibleCloseCount

  const layoutDeltas = [params.layout.tabWidthDeltaPx, params.layout.titleWidthDeltaPx, params.layout.titleLeftDeltaPx]
  const layoutOk = layoutDeltas.every(d => d == null || d <= 1)

  const noPointerSource = params.origin === 'none' && target < 0
  const pointerSource = params.origin !== 'none' && target >= 0

  if (!layoutOk) {
    return { visibleCloseCount, otherVisibleCloseCount, defaultStateOk: false, hoverOrFocusStateOk: false, layoutOk: false, decision: 'FAIL', reason: 'TAB_CLOSE_CAUSES_LAYOUT_SHIFT' }
  }
  if (noPointerSource) {
    const defaultStateOk = visibleCloseCount === 0 && params.tabCount >= 0
    return {
      visibleCloseCount,
      otherVisibleCloseCount: 0,
      defaultStateOk,
      hoverOrFocusStateOk: true,
      layoutOk: true,
      decision: defaultStateOk ? 'PASS' : 'FAIL',
      reason: defaultStateOk ? 'DEFAULT_ZERO_VISIBLE' : 'VISIBLE_CLOSE_MISMATCH',
    }
  }
  if (pointerSource) {
    const exactlyOne = visibleCloseCount === 1 && params.visibleIndices[0] === target
    const stateOk = exactlyOne && otherVisibleCloseCount === 0
    return {
      visibleCloseCount,
      otherVisibleCloseCount,
      defaultStateOk: false,
      hoverOrFocusStateOk: stateOk,
      layoutOk: true,
      decision: stateOk ? 'PASS' : 'FAIL',
      reason: stateOk
        ? (params.origin === 'focus' ? 'FOCUS_ONLY_CURRENT' : 'HOVER_ONLY_CURRENT')
        : 'VISIBLE_CLOSE_MISMATCH',
    }
  }
  return {
    visibleCloseCount,
    otherVisibleCloseCount,
    defaultStateOk: false,
    hoverOrFocusStateOk: false,
    layoutOk: true,
    decision: 'FAIL',
    reason: 'VISIBLE_CLOSE_MISMATCH',
  }
}

/** Read a tab's close visibility from computed style (real layout only). */
export function isCloseElementVisible(close: HTMLElement): boolean {
  const cs = window.getComputedStyle(close)
  const opacity = Number.parseFloat(cs.opacity)
  return Number.isFinite(opacity) && opacity > 0.5 && cs.visibility !== 'hidden'
}

export interface MeasuredTabCloseState {
  tabCount: number
  activeIndex: number
  hoveredOrFocusedIndex: number
  visibleIndices: number[]
  closeSlotWidthsPx: number[]
  origin: 'hover' | 'focus' | 'none'
}

/** Measure the CURRENT state in the real DOM (default/hover decided by CSS). */
export function measureTabCloseVisibility(root: ParentNode = document): MeasuredTabCloseState {
  const tabs = Array.from(root.querySelectorAll<HTMLElement>('.typ-workspace-tabs .typ-tab, .typ-workspace-tab-header .typ-tab'))
  const activeIndex = tabs.findIndex(el => el.classList.contains('active'))
  const visibleIndices: number[] = []
  const closeSlotWidthsPx: number[] = []
  tabs.forEach((tab, index) => {
    const close = tab.querySelector<HTMLElement>('.typ-close')
    if (!close) return
    if (isCloseElementVisible(close)) visibleIndices.push(index)
    closeSlotWidthsPx.push(close.getBoundingClientRect().width)
  })
  return {
    tabCount: tabs.length,
    activeIndex,
    hoveredOrFocusedIndex: -1,
    visibleIndices,
    closeSlotWidthsPx,
    origin: 'none',
  }
}

/** Single-mount guard used by the runtime invariant (no listeners). */
export class TabCloseVisibilityEnhancer {
  private disposed = false

  attach(): this {
    if (this.disposed) return this
    tabCloseEnhancerInstanceCount++
    return this
  }

  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    tabCloseEnhancerInstanceCount = Math.max(0, tabCloseEnhancerInstanceCount - 1)
  }

  getInvariant(): { tabCloseEnhancerCount: number; duplicateListener: boolean } {
    return {
      tabCloseEnhancerCount: tabCloseEnhancerInstanceCount,
      duplicateListener: tabCloseEnhancerInstanceCount > 1,
    }
  }
}

// ── V2 centering facts ──────────────────────────────────────────────────────

export interface TabCloseCenteringEvaluationParams {
  /** ±px tolerance check when a real glyph rect was measurable. */
  deltaCenterX: number | null
  deltaCenterY: number | null
  widthPx: number | null
  heightPx: number | null
  paddingZero: boolean
  marginZero: boolean
  inlineFlex: boolean
  alignItemsCenter: boolean
  justifyContentCenter: boolean
  square: boolean
  pseudoNoOffset: boolean
  slotWidthDefault: number | null
  slotWidthHover: number | null
  tabWidthDeltaPx: number | null
  titleWidthDeltaPx: number | null
  titleLeftDeltaPx: number | null
}

export interface TabCloseCenteringResult {
  measureMode: 'REAL' | 'STRUCTURAL'
  hitboxOk: boolean
  centerOk: boolean
  slotStable: boolean
  layoutStable: boolean
  decision: 'PASS' | 'FAIL'
  reason: string
}

/** Pure centering decision logic (V2). */
export function evaluateTabCloseCentering(p: TabCloseCenteringEvaluationParams): TabCloseCenteringResult {
  const canRealMeasure = p.deltaCenterX != null && p.deltaCenterY != null
  const measureMode: 'REAL' | 'STRUCTURAL' = canRealMeasure ? 'REAL' : 'STRUCTURAL'

  const sizeOk = p.widthPx != null && p.heightPx != null && Math.abs(p.widthPx - p.heightPx) <= 1 && p.widthPx >= 18 && p.widthPx <= 22
  const hitboxOk = sizeOk && p.paddingZero && p.marginZero && p.inlineFlex && p.alignItemsCenter && p.justifyContentCenter && p.square
  const centerOk = canRealMeasure ? (Math.abs(p.deltaCenterX!) <= 1 && Math.abs(p.deltaCenterY!) <= 1) : hitboxOk
  const slotStable = p.slotWidthDefault != null && p.slotWidthHover != null ? Math.abs(p.slotWidthDefault - p.slotWidthHover) <= 1 : true
  const deltas = [p.tabWidthDeltaPx, p.titleWidthDeltaPx, p.titleLeftDeltaPx]
  const layoutStable = deltas.every(d => d == null || d <= 1)

  if (hitboxOk && centerOk && slotStable && layoutStable && p.pseudoNoOffset) {
    return { measureMode, hitboxOk, centerOk, slotStable, layoutStable, decision: 'PASS', reason: canRealMeasure ? 'GLYPH_CENTERED_WITHIN_HITBOX' : 'HITBOX_AND_GLYPH_CENTERED' }
  }
  let reason = 'HITBOX_OR_CENTER_RULE_MISSING'
  if (hitboxOk && !centerOk) reason = 'GLYPH_CENTER_MISMATCH'
  else if (slotStable === false) reason = 'CLOSE_SLOT_WIDTH_UNSTABLE'
  else if (!layoutStable) reason = 'TAB_TITLE_LAYOUT_SHIFT'
  return { measureMode, hitboxOk, centerOk, slotStable, layoutStable, decision: 'FAIL', reason }
}

/** Structural/real measurement of a close button's box + computed rules. */
export function measureTabCloseCentering(root: ParentNode = document): {
  closeRect: { width: number; height: number } | null
  computed: { display: string; alignItems: string; justifyContent: string; padding: string; margin: string; lineHeight: string; border: string } | null
  pseudo: { content: string; display: string; padding: string; margin: string; lineHeight: string; fontSize: string; top: string; left: string; transform: string } | null
} {
  const close = root.querySelector<HTMLElement>('.typ-workspace-tabs .typ-tab .typ-close, .typ-workspace-tab-header .typ-tab .typ-close')
  if (!close) return { closeRect: null, computed: null, pseudo: null }
  const rect = close.getBoundingClientRect()
  const cs = window.getComputedStyle(close)
  const ps = window.getComputedStyle(close, '::before')
  return {
    closeRect: { width: rect.width, height: rect.height },
    computed: { display: cs.display, alignItems: cs.alignItems, justifyContent: cs.justifyContent, padding: cs.padding, margin: cs.margin, lineHeight: cs.lineHeight, border: `${cs.borderTopWidth} ${cs.borderTopStyle}` },
    pseudo: { content: ps.content, display: ps.display, padding: ps.padding, margin: ps.margin, lineHeight: ps.lineHeight, fontSize: ps.fontSize, top: ps.top, left: ps.left, transform: ps.transform },
  }
}
