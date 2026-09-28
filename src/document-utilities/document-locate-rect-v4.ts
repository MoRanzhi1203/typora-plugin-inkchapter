/**
 * Phase 7R.3.11.8B.13 — Diagnostic Locate Visual Geometry V4: RECT authority.
 *
 * ONE pure geometry factory for every derived rectangle in the locate visual
 * pipeline. Invariants:
 *   width  = right - left   (|Δ| <= 0.5)
 *   height = bottom - top   (|Δ| <= 0.5)
 *   x == left / y == top / right >= left / bottom >= top
 *
 * Every inflate / clip / intersection / drawer-clip / editor-clip operation
 * MUST rebuild a RectSnapshot through makeRectSnapshot — never
 * `{ ...rect, right: clippedRight }` (that keeps a stale width and breaks the
 * invariants).
 */
export interface RectSnapshot {
  x: number
  y: number
  left: number
  top: number
  right: number
  bottom: number
  width: number
  height: number
}

/** Finite-number normalizer: NaN/±Infinity collapse to the safe boundary. */
function finite(n: number): number {
  return Number.isFinite(n) ? n : 0
}

/**
 * UNIQUE rect factory. width/height are ALWAYS re-derived from the borders —
 * a caller can never smuggle a stale width/height through.
 */
export function makeRectSnapshot(input: { left: number; top: number; right: number; bottom: number }): RectSnapshot {
  const l = finite(input.left)
  const t = finite(input.top)
  const r = Math.max(l, finite(input.right))
  const b = Math.max(t, finite(input.bottom))
  return { x: l, y: t, left: l, top: t, right: r, bottom: b, width: r - l, height: b - t }
}

/** Build a snapshot from a DOMRect-like (ignores its own width/height). */
export function snapshotDomRect(r: { left: number; top: number; right: number; bottom: number } | null): RectSnapshot | null {
  if (!r) return null
  return makeRectSnapshot({ left: r.left, top: r.top, right: r.right, bottom: r.bottom })
}

/** Inflate by `gap` on every side (gap < 0 shrinks). Rebuilds the snapshot. */
export function inflateRectBy(rect: RectSnapshot | { left: number; top: number; right: number; bottom: number }, gap: number): RectSnapshot {
  if (gap === 0) return makeRectSnapshot(rect)
  return makeRectSnapshot({ left: rect.left - gap, top: rect.top - gap, right: rect.right + gap, bottom: rect.bottom + gap })
}

/**
 * V5.4 — UNIQUE viewport → overlay-host conversion. The result is rebuilt via
 * makeRectSnapshot so right = left + width and bottom = top + height ALWAYS
 * hold. Scroll offsets are applied when the host scrolls its own content.
 */
export function viewportToHostRect(
  rect: { left: number; top: number; right: number; bottom: number },
  hostRect: { left: number; top: number; right: number; bottom: number } | null,
  scrollLeft = 0,
  scrollTop = 0,
): RectSnapshot {
  const hostL = hostRect?.left ?? 0
  const hostT = hostRect?.top ?? 0
  return makeRectSnapshot({
    left: rect.left - hostL + scrollLeft,
    top: rect.top - hostT + scrollTop,
    right: rect.right - hostL + scrollLeft,
    bottom: rect.bottom - hostT + scrollTop,
  })
}

/** Clip `rect` to `clip`; null when no positive area survives. Rebuilds. */
export function clampRectToClip(
  rect: RectSnapshot | { left: number; top: number; right: number; bottom: number },
  clip: RectSnapshot | { left: number; top: number; right: number; bottom: number },
): RectSnapshot | null {
  const out = makeRectSnapshot({
    left: Math.max(rect.left, clip.left),
    top: Math.max(rect.top, clip.top),
    right: Math.min(rect.right, clip.right),
    bottom: Math.min(rect.bottom, clip.bottom),
  })
  if (out.right <= out.left || out.bottom <= out.top) return null
  return out
}

/** Union of client rects (meaningful non-empty boxes only). Null when none. */
export function unionClientRects(rects: ArrayLike<DOMRect> | DOMRect[] | readonly DOMRect[] | null | undefined): RectSnapshot | null {
  if (!rects || rects.length === 0) return null
  let l = Infinity
  let t = Infinity
  let r = -Infinity
  let b = -Infinity
  let any = false
  for (const q of Array.from(rects as DOMRect[])) {
    if (q.width <= 0 || q.height <= 0) continue
    if (!Number.isFinite(q.left) || !Number.isFinite(q.right)) continue
    l = Math.min(l, q.left)
    t = Math.min(t, q.top)
    r = Math.max(r, q.right)
    b = Math.max(b, q.bottom)
    any = true
  }
  return any ? makeRectSnapshot({ left: l, top: t, right: r, bottom: b }) : null
}

/** RECT-INVARIANT-1..5. Returns true only when every check passes. */
export function validateRectInvariants(rect: RectSnapshot | null | undefined): boolean {
  if (!rect) return false
  if (Math.abs(rect.width - (rect.right - rect.left)) > 0.5) return false
  if (Math.abs(rect.height - (rect.bottom - rect.top)) > 0.5) return false
  if (rect.x !== rect.left) return false
  if (rect.y !== rect.top) return false
  if (rect.right < rect.left) return false
  if (rect.bottom < rect.top) return false
  return true
}
