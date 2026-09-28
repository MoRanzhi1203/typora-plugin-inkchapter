/**
 * V5.12-R2 — DocumentLayoutEpoch (pure contract).
 *
 * ROOT_R2_1 = PASSIVE_MARKER_MEASURED_BEFORE_LAYOUT_SETTLED
 *           AND
 *             LAYOUT_AFFECTING_PLUGIN_MUTATION_DID_NOT_INVALIDATE_MARKER_GEOMETRY
 *
 * ONE document-level layout epoch. Every diagnostic visual measurement stores
 * the epoch it was measured in; a measurement whose epoch differs from the
 * current epoch is STALE and must never be painted or committed as final.
 *
 * The epoch may only be bumped by events that REALLY change the geometry of
 * `#write`. Scroll / wheel / pointer / selection / focus / drawer hover /
 * active-diagnostic changes are explicitly FORBIDDEN bump sources — they must
 * never invalidate geometry (that would re-introduce a scroll-driven
 * remeasure loop).
 *
 * No DOM access, no host state.
 */

export type DocumentLayoutEpoch = number

/** Every mutation source that may ask to bump the document layout epoch. */
export type LayoutMutationKind =
  // ── layout-affecting (may bump) ───────────────────────────────────────────
  | 'CAPTION_PROJECTION_MOUNT'
  | 'CAPTION_PROJECTION_UNMOUNT'
  | 'CAPTION_PROJECTION_REPLACE'
  | 'HEADING_NUMBERING_PROJECTION'
  | 'FORMULA_PROJECTION'
  | 'OBJECT_CAPTION_INSERT'
  | 'OBJECT_CAPTION_REMOVE'
  | 'THEME_OR_FONT_SETTLE'
  | 'WINDOW_LAYOUT_SETTLE'
  | 'PLUGIN_DOM_MUTATION'
  | 'DOCUMENT_SWITCH'
  | 'DOCUMENT_LOAD'
  | 'EDIT_STRUCTURE_CHANGE'
  // ── NOT layout-affecting (must never bump) ────────────────────────────────
  | 'SCROLL'
  | 'WHEEL'
  | 'POINTER_MOVE'
  | 'MOUSE_MOVE'
  | 'SELECTION_CHANGE'
  | 'FOCUS_CHANGE'
  | 'DRAWER_HOVER'
  | 'ACTIVE_DIAGNOSTIC_CHANGE'

/** §3.2 — the ONLY legal bump sources. */
export const LAYOUT_EPOCH_BUMP_KINDS: readonly LayoutMutationKind[] = [
  'CAPTION_PROJECTION_MOUNT',
  'CAPTION_PROJECTION_UNMOUNT',
  'CAPTION_PROJECTION_REPLACE',
  'HEADING_NUMBERING_PROJECTION',
  'FORMULA_PROJECTION',
  'OBJECT_CAPTION_INSERT',
  'OBJECT_CAPTION_REMOVE',
  'THEME_OR_FONT_SETTLE',
  'WINDOW_LAYOUT_SETTLE',
  'PLUGIN_DOM_MUTATION',
  'DOCUMENT_SWITCH',
  'DOCUMENT_LOAD',
  'EDIT_STRUCTURE_CHANGE',
]

/** §3.2 — explicit non-sources (documented so a regression is provable). */
export const LAYOUT_EPOCH_FORBIDDEN_KINDS: readonly LayoutMutationKind[] = [
  'SCROLL',
  'WHEEL',
  'POINTER_MOVE',
  'MOUSE_MOVE',
  'SELECTION_CHANGE',
  'FOCUS_CHANGE',
  'DRAWER_HOVER',
  'ACTIVE_DIAGNOSTIC_CHANGE',
]

/** §3.2 — the single bump predicate (host and tests share it). */
export function shouldBumpLayoutEpoch(kind: LayoutMutationKind): boolean {
  return LAYOUT_EPOCH_BUMP_KINDS.includes(kind)
}

/** The next epoch value (monotonic; a bump is never a decrement/reset). */
export function nextLayoutEpoch(current: DocumentLayoutEpoch): DocumentLayoutEpoch {
  const n = Number(current)
  return (Number.isFinite(n) ? n : 0) + 1
}

/**
 * §3.1 — staleness authority. A measurement without an epoch (legacy writer)
 * is treated as CURRENT so an older code path can never fabricate a violation.
 */
export function isLayoutEpochStale(
  measured: DocumentLayoutEpoch | null | undefined,
  current: DocumentLayoutEpoch,
): boolean {
  if (measured == null) return false
  return measured !== current
}

/** §3.4 — the drift acceptance band for a re-measured passive marker target. */
export const PASSIVE_MARKER_DRIFT_HARD_PX = 1

/** §3.4 — a re-measured target that moved more than the hard band is drift. */
export function isPassiveMarkerDrift(
  previous: { left: number; top: number; right: number; bottom: number } | null | undefined,
  next: { left: number; top: number; right: number; bottom: number } | null | undefined,
): boolean {
  if (!previous || !next) return false
  return (
    Math.abs(previous.left - next.left) > PASSIVE_MARKER_DRIFT_HARD_PX ||
    Math.abs(previous.top - next.top) > PASSIVE_MARKER_DRIFT_HARD_PX ||
    Math.abs(previous.right - next.right) > PASSIVE_MARKER_DRIFT_HARD_PX ||
    Math.abs(previous.bottom - next.bottom) > PASSIVE_MARKER_DRIFT_HARD_PX
  )
}
