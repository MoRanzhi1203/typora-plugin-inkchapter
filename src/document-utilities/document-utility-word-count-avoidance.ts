/**
 * Navigator ↔ Typora native word-count panel avoidance.
 *
 * Typora 1.6.7 renders the word-count statistics panel as
 * `ul#footer-word-count-info.dropdown-menu` inside `footer.ty-footer`
 * (`#footer-word-count-info{right:4px;bottom:32px}`). The InkChapter scroll
 * navigator is a right/bottom anchored overlay, so an OPEN panel and the
 * navigator share the same bottom-right corner and the panel's statistics get
 * covered by the navigator box.
 *
 * The panel is NATIVE: its DOM, its z-index and its layout are never touched.
 * Only the navigator is moved — and only while the panel is open:
 *
 *   1. DEFAULT      panel closed, or the two boxes do not intersect → keep the
 *                   resolved (gutter/inset) position;
 *   2. SHIFT_LEFT   move the navigator LEFT so its right edge clears the
 *                   panel's left edge (preferred);
 *   3. SHIFT_UP     left space is exhausted → move it UP so its bottom edge
 *                   clears the panel's top edge;
 *   4. HIDE         neither direction has room → hide the navigator for the
 *                   lifetime of the open panel (restored on close).
 *
 * Everything here is a PURE function of measured rects (CSS pixels, DPR-free),
 * so window resize, sidebar pin/unpin, sidebar width drag, document scroll,
 * panel size changes and per-monitor DPI changes all funnel through the same
 * decision with freshly measured input.
 */

/** Axis-aligned rect in CSS pixels (viewport coordinates). */
export interface AvoidRect {
  left: number
  top: number
  right: number
  bottom: number
}

export type WordCountAvoidMode = 'DEFAULT' | 'SHIFT_LEFT' | 'SHIFT_UP' | 'HIDE'

export type WordCountAvoidReason =
  | 'PANEL_CLOSED'
  | 'NO_INTERSECTION'
  | 'SHIFT_LEFT'
  | 'SHIFT_UP'
  | 'NO_SPACE_LEFT_AND_UP'
  | 'NON_FINITE_GEOMETRY'
  | 'NO_NAVIGATOR_RECT'

export interface WordCountAvoidInput {
  /** Navigator rect at its RESOLVED (un-shifted) position. */
  navigator: AvoidRect | null
  /** Open panel rect; null/zero-size when the panel is closed. */
  panel: AvoidRect | null
  /** Left/top limits the navigator may still occupy (visible editor inset). */
  bounds: { left: number; top: number }
  /** Clearance between the navigator box and the panel box. */
  gap?: number
}

export interface WordCountAvoidResult {
  mode: WordCountAvoidMode
  /** Pixels the navigator must move LEFT (applied by INCREASING css `right`). */
  dx: number
  /** Pixels the navigator must move UP (applied by INCREASING css `bottom`). */
  dy: number
  reason: WordCountAvoidReason
  /** Compact identity used to dedupe geometry writes (no DOM churn). */
  signature: string
}

/** Default clearance between the navigator box and the native panel. */
export const WORD_COUNT_AVOID_GAP_PX = 8

const DEFAULT_RESULT: WordCountAvoidResult = {
  mode: 'DEFAULT',
  dx: 0,
  dy: 0,
  reason: 'PANEL_CLOSED',
  signature: 'DEFAULT|0|0|PANEL_CLOSED',
}

function finiteRect(r: AvoidRect | null): r is AvoidRect {
  return r != null
    && Number.isFinite(r.left) && Number.isFinite(r.top)
    && Number.isFinite(r.right) && Number.isFinite(r.bottom)
    && r.right > r.left && r.bottom > r.top
}

function intersects(a: AvoidRect, b: AvoidRect, gap: number): boolean {
  return a.left < b.right + gap && a.right > b.left - gap
    && a.top < b.bottom + gap && a.bottom > b.top - gap
}

function makeResult(
  mode: WordCountAvoidMode,
  dx: number,
  dy: number,
  reason: WordCountAvoidReason,
): WordCountAvoidResult {
  return { mode, dx, dy, reason, signature: `${mode}|${dx}|${dy}|${reason}` }
}

/**
 * Decide how the navigator avoids an OPEN word-count panel.
 *
 * NEVER mutates anything: the caller writes the returned offset onto the
 * navigator and restores the base position when `mode === 'DEFAULT'`.
 */
export function computeWordCountPanelAvoidance(input: WordCountAvoidInput): WordCountAvoidResult {
  const gap = Number.isFinite(input.gap as number) ? (input.gap as number) : WORD_COUNT_AVOID_GAP_PX
  const navigator = input.navigator
  const panel = input.panel

  // Closed / not measurable → keep the resolved position untouched.
  if (!finiteRect(panel)) return DEFAULT_RESULT
  if (!finiteRect(navigator)) return { ...DEFAULT_RESULT, reason: 'NO_NAVIGATOR_RECT', signature: 'DEFAULT|0|0|NO_NAVIGATOR_RECT' }
  if (!Number.isFinite(input.bounds.left) || !Number.isFinite(input.bounds.top)) {
    return { ...DEFAULT_RESULT, reason: 'NON_FINITE_GEOMETRY', signature: 'DEFAULT|0|0|NON_FINITE_GEOMETRY' }
  }

  if (!intersects(navigator, panel, gap)) {
    return { ...DEFAULT_RESULT, reason: 'NO_INTERSECTION', signature: 'DEFAULT|0|0|NO_INTERSECTION' }
  }

  // 1) Prefer moving LEFT: the navigator's right edge must clear panel.left - gap.
  const targetRight = panel.left - gap
  const dxRaw = navigator.right - targetRight
  if (dxRaw > 0) {
    const dx = Math.ceil(dxRaw)
    if (navigator.left - dx >= input.bounds.left - 0.5) {
      return makeResult('SHIFT_LEFT', dx, 0, 'SHIFT_LEFT')
    }
  }

  // 2) Left space exhausted → move UP: bottom edge must clear panel.top - gap.
  const targetBottom = panel.top - gap
  const dyRaw = navigator.bottom - targetBottom
  if (dyRaw > 0) {
    const dy = Math.ceil(dyRaw)
    if (navigator.top - dy >= input.bounds.top - 0.5) {
      return makeResult('SHIFT_UP', 0, dy, 'SHIFT_UP')
    }
  }

  // 3) No room in either direction → temporary hide while the panel is open.
  return makeResult('HIDE', 0, 0, 'NO_SPACE_LEFT_AND_UP')
}

/** Attribute carrying the temporary, panel-scoped hide state. */
export const NAV_WORD_COUNT_AVOID_ATTR = 'data-ink-wc-avoid'

/** Native expand marker: Typora toggles `body.ty-show-word-count` on click. */
export const WORD_COUNT_PANEL_OPEN_CLASS = 'ty-show-word-count'

/** Live measurement of the NATIVE panel (read-only; never mutates it). */
export interface WordCountPanelMeasurement {
  /** Body marker present AND the panel has a real rendered box. */
  open: boolean
  rect: AvoidRect | null
}

/**
 * Measure the native word-count panel without touching it.
 *
 * `display:none` (closed, or source-code mode where Typora hides the footer
 * widgets) yields a zero box → treated as closed, so no avoidance is applied.
 */
export function measureWordCountPanelRect(doc: Document | null): WordCountPanelMeasurement {
  if (!doc || !doc.body) return { open: false, rect: null }
  const open = doc.body.classList.contains(WORD_COUNT_PANEL_OPEN_CLASS)
  if (!open) return { open: false, rect: null }
  let el: HTMLElement | null = null
  try { el = doc.getElementById('footer-word-count-info') } catch { el = null }
  if (!el) return { open: false, rect: null }
  let r: DOMRect | null = null
  try { r = el.getBoundingClientRect() } catch { r = null }
  if (!r || r.width <= 0 || r.height <= 0) return { open: true, rect: null }
  return { open: true, rect: { left: r.left, top: r.top, right: r.right, bottom: r.bottom } }
}

/** Base (resolved) navigator anchor, in the same units as css right/bottom. */
export interface NavigatorBaseAnchor {
  right: number
  bottom: number
}

/**
 * Single DOM writer for the avoidance state. `mode === 'DEFAULT'` RESTORES the
 * base anchor exactly (no residual offset can survive a panel close).
 */
export function writeNavigatorWordCountAvoidance(
  el: HTMLElement | null,
  base: NavigatorBaseAnchor,
  result: WordCountAvoidResult,
): void {
  if (!el) return
  if (result.mode === 'HIDE') {
    el.setAttribute(NAV_WORD_COUNT_AVOID_ATTR, 'hidden')
    // Both channels agree: the attribute (CSS author rule) and the native
    // `hidden` property, so audits that read `el.hidden` see the real state.
    el.hidden = true
    el.style.display = 'none'
    return
  }
  if (el.hasAttribute(NAV_WORD_COUNT_AVOID_ATTR)) el.removeAttribute(NAV_WORD_COUNT_AVOID_ATTR)
  // Restore: the caller only reaches this branch while the presentation itself
  // is visible, so a stale `hidden` from a previous HIDE must never survive.
  if (el.hidden) el.hidden = false
  el.style.display = 'flex'
  el.style.right = `${base.right + result.dx}px`
  el.style.bottom = `${base.bottom + result.dy}px`
}
