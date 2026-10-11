/**
 * Phase 7R.3.11.8B.24 — Diagnostic Locate Document-Space Visual Carrier V5.11
 * (pure contract).
 *
 * The V5.7/V5.8/V5.9/V5.10 visual lived in the VIEWPORT overlay and needed a
 * scroll-driven repaint to stay glued to the target. That gave the scroll
 * listener far too much authority: a post-COMMIT user scroll could re-enter
 * remeasure / repaint / re-resolve / recenter and change the committed
 * presentation, compound bounds or inline fragments.
 *
 * V5.11 principle:
 *
 *   PRE-COMMIT  → measure / scroll / place / paint / verify   (viewport space)
 *   POST-COMMIT → native Typora scroll ONLY, locate subsystem INERT
 *
 * The committed carrier is converted ONCE into DOCUMENT-LOCAL geometry and
 * mounted inside a document-space layer, so it scrolls with the Markdown
 * content without any plugin work.
 *
 *   POST-COMMIT USER SCROLL IS VISUALLY INERT
 *
 * No DOM access, no host state.
 */

export interface DocumentSpaceRect {
  x: number
  y: number
  left: number
  top: number
  right: number
  bottom: number
  width: number
  height: number
}

function makeRect(left: number, top: number, right: number, bottom: number): DocumentSpaceRect {
  const l = Number(left)
  const t = Number(top)
  const r = Math.max(l, Number(right))
  const b = Math.max(t, Number(bottom))
  return { x: l, y: t, left: l, top: t, right: r, bottom: b, width: r - l, height: b - t }
}

/** §7 — a derived rect is ALWAYS fully rebuilt (never `{...old, top}`). */
export function makeDocumentSpaceRect(input: { left: number; top: number; right: number; bottom: number }): DocumentSpaceRect {
  return makeRect(input.left, input.top, input.right, input.bottom)
}

export interface ViewportRectLike {
  left: number
  top: number
  right: number
  bottom: number
}

/**
 * §7 — THE single viewport → document-local conversion authority.
 *
 * The document-space layer shares the content host's containing block, so the
 * document-local offset of a viewport rect is simply its delta against the
 * content host's viewport rect. `scrollTop` must NOT be added again (that is
 * the "repeated compensation" the spec forbids): the layer already lives in the
 * scrolled content.
 */
export function viewportRectToDocumentLocalRect(input: {
  viewportRect: ViewportRectLike | null
  contentHostRect: ViewportRectLike | null
}): DocumentSpaceRect | null {
  const { viewportRect, contentHostRect } = input
  if (!viewportRect || !contentHostRect) return null
  const left = Number(viewportRect.left) - Number(contentHostRect.left)
  const top = Number(viewportRect.top) - Number(contentHostRect.top)
  const right = Number(viewportRect.right) - Number(contentHostRect.left)
  const bottom = Number(viewportRect.bottom) - Number(contentHostRect.top)
  if (![left, top, right, bottom].every(Number.isFinite)) return null
  return makeRect(left, top, right, bottom)
}

/** §26 — document-local drift between the committed and the observed rect. */
export function documentLocalDrift(a: DocumentSpaceRect | null, b: DocumentSpaceRect | null): number | null {
  if (!a || !b) return null
  return Math.max(
    Math.abs(a.left - b.left),
    Math.abs(a.top - b.top),
    Math.abs(a.right - b.right),
    Math.abs(a.bottom - b.bottom),
  )
}

/** §21 — the layout fingerprint: PURE SCROLL keeps it stable. */
export interface LocateLayoutFingerprint {
  documentHostWidth: number
  semanticWidth: number
  semanticHeight: number
  primaryWidth: number | null
  primaryHeight: number | null
  secondaryWidth: number | null
  secondaryHeight: number | null
  lineFragmentCount: number | null
  structureRevision: number
}

export function layoutFingerprintKey(fp: LocateLayoutFingerprint): string {
  return [
    Math.round(fp.documentHostWidth),
    Math.round(fp.semanticWidth),
    Math.round(fp.semanticHeight),
    fp.primaryWidth == null ? '-' : Math.round(fp.primaryWidth),
    fp.primaryHeight == null ? '-' : Math.round(fp.primaryHeight),
    fp.secondaryWidth == null ? '-' : Math.round(fp.secondaryWidth),
    fp.secondaryHeight == null ? '-' : Math.round(fp.secondaryHeight),
    fp.lineFragmentCount == null ? '-' : fp.lineFragmentCount,
    fp.structureRevision,
  ].join('|')
}

/**
 * §19/§21 — ONLY a real layout reflow may trigger a same-target reconcile.
 * Width/height/structure changes count; a pure scroll can never change them.
 */
export function isLayoutReflow(prev: LocateLayoutFingerprint | null, next: LocateLayoutFingerprint | null): boolean {
  if (!prev || !next) return false
  // A <1px rounding difference is not a reflow.
  const near = (a: number, b: number): boolean => Math.abs(a - b) <= 1
  if (!near(prev.documentHostWidth, next.documentHostWidth)) return true
  if (!near(prev.semanticWidth, next.semanticWidth)) return true
  if (!near(prev.semanticHeight, next.semanticHeight)) return true
  if (prev.primaryWidth != null && next.primaryWidth != null && !near(prev.primaryWidth, next.primaryWidth)) return true
  if (prev.primaryHeight != null && next.primaryHeight != null && !near(prev.primaryHeight, next.primaryHeight)) return true
  if (prev.secondaryWidth != null && next.secondaryWidth != null && !near(prev.secondaryWidth, next.secondaryWidth)) return true
  if (prev.secondaryHeight != null && next.secondaryHeight != null && !near(prev.secondaryHeight, next.secondaryHeight)) return true
  if (prev.lineFragmentCount != null && next.lineFragmentCount != null && prev.lineFragmentCount !== next.lineFragmentCount) return true
  if (prev.structureRevision !== next.structureRevision) return true
  return false
}

/** §26 — the document-space drift acceptance band. */
export const DOCUMENT_SPACE_DRIFT_RECOMMENDED_PX = 1
export const DOCUMENT_SPACE_DRIFT_HARD_PX = 2

/** V5.11 — the document-space audit event name. */
export const LOCATE_DOCUMENT_SPACE_AUDIT_EVENT = 'DOCUMENT-DIAGNOSTIC-LOCATE-DOCUMENT-SPACE-AUDIT'

/** V5.11 — the document-space layer class (carrier containing block). */
export const LOCATE_DOCUMENT_LAYER_CLASS = 'inkchapter-locate-document-layer'

/** §25 — the hard counters (every one must stay 0). */
export const LOCATE_DOCUMENT_SPACE_V511_GATE_KEYS = [
  'postCommitUserScrollRepaint',
  'postCommitUserScrollRemeasure',
  'postCommitUserScrollReresolve',
  'postCommitUserScrollRecenter',
  'postCommitUserScrollWrite',
  'postCommitPresentationKindChange',
  'postCommitTargetIdentityChange',
  'postCommitPrimaryAnchorChange',
  'postCommitSecondaryAnchorChange',
  'postCommitCompoundBoundsChange',
  'postCommitInlineRemeasureOnScroll',
  'postCommitInlineOccurrenceChange',
  'userScrollReentersLocateTransaction',
  'documentSpaceOverlayScrollDrift',
  'layoutReconcileTargetIdentityChange',
  'layoutReconcilePresentationKindChange',
  'locateVisualReappearAfterDocumentDismiss',
  'postDismissRecenter',
  /**
   * §二/§五/§七 — INDEPENDENT post-commit paint drift of the FINAL document-space
   * carrier. The clone is mounted AFTER every pre-existing verification (and the
   * viewport frame is released in the same step), so until now NOTHING measured the
   * node the user actually sees: a paint layer whose containing block / offsetParent
   * / transform does not coincide with the measured content host could shift the
   * carrier with no audit able to observe it. This is FATAL: >1px on the REAL node.
   */
  'docSpaceCarrierPaintDriftGt1px',
  /**
   * ROOT_ACTIVE_DUP_CARRIER §一/§四/§六 —— a PRE-COMMIT viewport frame that
   * outlived its commit. `commitDiagnosticLocateVisual` re-presents the viewport
   * frame; on the click path `commitDocumentSpaceCarrier` clones it into the
   * document-space layer AND releases the viewport original. A POST-COMMIT
   * geometry refresh (layout-invalidation remeasure) has no such clone step, so
   * without an explicit release the viewport frame survives as a SECOND marker —
   * identical at first, then diverging on the next scroll because it is
   * VIEWPORT-FIXED. `frameCount=1 / staleLocateFrameCount=0` can NOT see this
   * (they describe the frame element itself, which IS the leftover). A committed
   * document-space carrier + a live viewport frame is therefore FATAL.
   */
  'locateViewportFrameLingeringAfterCommit',
  /**
   * ROOT_COMPOUND_CAPTION_COVERAGE §一/§三/§六 —— a layout reconcile re-derived the
   * committed carrier from the semantic ANCHOR alone, so a COMPOUND target
   * (CODE_MISSING_NAME: caption + body) collapsed onto the code body and DROPPED the
   * caption highlight. The carrier must be re-derived with the SAME per-edge relation
   * captured at commit; a caption left outside the painted carrier is FATAL.
   */
  'compoundCaptionUncoveredAfterReconcile',
  /**
   * ROOT_COMPOUND_CAPTION_COVERAGE §3.3/§3.5 —— the caption PRIMARY child (the
   * name-slot cue) of a committed composite carrier no longer covers the LIVE
   * caption after a layout reconcile, or is missing entirely. The carrier is a deep
   * clone, so resizing only the outer box left the child at its COMMIT-time
   * offsets/width — the reported "题注高亮消失/不一致". A composite sub-layer that is
   * lost (or fails to cover its target) is FATAL.
   */
  'compoundCaptionCueUncoveredAfterReconcile',
] as const

export type LocateDocumentSpaceV511GateKey = typeof LOCATE_DOCUMENT_SPACE_V511_GATE_KEYS[number]

export function createLocateDocumentSpaceV511GateCounters(): Record<LocateDocumentSpaceV511GateKey, number> {
  const out = {} as Record<LocateDocumentSpaceV511GateKey, number>
  for (const key of LOCATE_DOCUMENT_SPACE_V511_GATE_KEYS) out[key] = 0
  return out
}
