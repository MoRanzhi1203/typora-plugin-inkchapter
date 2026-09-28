/**
 * Phase 7R.3.11.8B.8 — Document Diagnostic Locate Frame (V3 overlay visual).
 *
 * V3 visual model (replaces "paint the target's own DOM background"):
 *
 *   Complex Block  (table / code / figure / formula / blockquote / block)
 *                  -> ONE severity-aware absolutely-positioned OVERLAY FRAME
 *                     mounted inside the existing document-utilities overlay
 *                     root. The target's own DOM stays untouched.
 *   Heading        -> compact severity LEFT INDICATOR only (no full-width band).
 *   Inline         -> precise severity-aware inline mark on the inline element.
 *
 * The frame only consumes what the locator already resolved:
 *   anchor element / severity / target kind / diagnosticId.
 * It never re-queries the document, never re-locates, never re-infers a source
 * anchor. It is a pure presentation layer. Position is derived from the live
 * anchor rect in VIEWPORT coordinates — the overlay root is a fixed
 * full-viewport containing block, so viewport client coords map 1:1 into it.
 *
 * Lifecycle contract (enforced here + by the host):
 *   locateFrameCount <= 1 / inlineMarkCount <= 1 / stale = 0.
 */
export const DIAGNOSTIC_LOCATE_FRAME_CLASS = 'inkchapter-diagnostic-locate-frame'
export const DIAGNOSTIC_INLINE_MARK_CLASS = 'inkchapter-diagnostic-inline-mark'
/** V5.12-R2 §10 — ONE overlay child per VISUAL LINE of an inline source range. */
export const DIAGNOSTIC_INLINE_FRAGMENT_CLASS = 'inkchapter-diagnostic-inline-fragment'
export const DIAGNOSTIC_LOCATE_CAPTION_CUE_CLASS = 'inkchapter-diagnostic-locate-marker'

import {
  clampRectToClip,
  inflateRectBy,
  makeRectSnapshot,
  snapshotDomRect,
  validateRectInvariants,
  type RectSnapshot,
} from './document-locate-rect-v4'
import {
  buildLocateVisualGeometryV4,
  measureTextFragmentRects,
  measureTextRects,
} from './document-locate-visual-geometry-v4'
import {
  fragmentCoverageRatio,
  hasCrossLineUnion,
  type ClosureRect,
} from './document-diagnostic-visual-closure-v512-r2'

export type DiagnosticLocateSeverity = 'error' | 'warning' | 'info'

/**
 * Visual target kind — the CARRIER decides the presentation (frame vs heading
 * indicator vs inline mark). It is derived from the RESOLVED anchor element
 * only (tag identity), never from a document-wide re-query.
 */
export type DiagnosticLocateTargetKind =
  | 'heading'
  | 'table'
  | 'code'
  | 'figure'
  | 'formula'
  | 'blockquote'
  | 'block'
  | 'inline'

export interface RectLike {
  left: number
  top: number
  right: number
  bottom: number
  width: number
  height: number
}

export interface DiagnosticLocateVisualCommit {
  diagnosticId: string | null
  severity: DiagnosticLocateSeverity
  /** Resolved anchor element (already located by the locator). */
  anchor: HTMLElement | null
  /** Explicit carrier; when absent it is derived from the anchor element. */
  kind?: DiagnosticLocateTargetKind | null
  /** V4 — exact inline geometry (sourceRange-exact missing-image / text box). */
  preciseRect?: RectLike | null
  /**
   * V5.12-R2 §10 (runtime closure) — the EXACT source token the precise range
   * belongs to (e.g. the raw Markdown destination `a%20b.png`). When present the
   * inline fragments are measured on that TEXT RANGE (per visual line) instead
   * of the whole owning element — a wrapped token must NEVER be painted as one
   * block-sized union rectangle.
   */
  preciseTextPrefix?: string | null
  /**
   * V5.12-R5 §8.2 — which occurrence of the source token inside the owning block
   * this target IS (0-based, verified). A duplicate destination must measure its
   * OWN token; the default 0 keeps every single-occurrence path unchanged.
   */
  preciseOccurrenceWithinAnchor?: number
  /** V4 — render as an inline mark even for an owning block target. */
  forceInlineMark?: boolean
  /** V4 — caption / expected-name host rect (missing-name diagnostics). */
  captionHostRect?: RectLike | null
}

export interface DiagnosticLocateFrameStructure {
  locateFrameCount: number
  duplicateLocateFrame: boolean
  staleLocateFrameCount: number
  inlineMarkCount: number
  duplicateInlineMark: boolean
  active: boolean
  activeDiagnosticId: string | null
  kind: DiagnosticLocateTargetKind | null
  severity: DiagnosticLocateSeverity | null
  /**
   * V5.12-R2 §5 — a heading visual is carried by the TEXT-TIGHT heading marker,
   * never by a legacy block frame. `true` means the controller deliberately
   * mounted NO frame element for a heading target.
   */
  headingMarkerCarrier: boolean
  /** V5.12-R2 §10 — overlay fragments actually painted for an inline range. */
  inlineFragmentCount: number
}

/**
 * Classify the RESOLVED anchor element into a visual carrier kind.
 * Pure tag/class identity — no document query, no source re-resolution.
 */
export function classifyDiagnosticLocateElement(el: HTMLElement | null): DiagnosticLocateTargetKind {
  if (!el) return 'block'
  const tag = el.tagName
  if (/^H[1-6]$/.test(tag)) return 'heading'
  if (tag === 'TABLE') return 'table'
  if (tag === 'PRE') return 'code'
  if (tag === 'IMG' || tag === 'FIGURE') return 'figure'
  if (tag === 'BLOCKQUOTE') return 'blockquote'
  // MathJax / KaTeX render hosts.
  const cls = typeof el.className === 'string' ? el.className : ''
  if (tag === 'DIV' && /(^|\s)(math|MathJax|katex)(\s|$)/i.test(cls)) return 'formula'
  if (tag === 'DIV' || tag === 'P' || tag === 'UL' || tag === 'OL' || tag === 'LI' || tag === 'SECTION') return 'block'
  return 'inline'
}

function clampRect(rect: RectLike, clip: RectLike): RectLike | null {
  const left = Math.max(rect.left, clip.left)
  const top = Math.max(rect.top, clip.top)
  const right = Math.min(rect.right, clip.right)
  const bottom = Math.min(rect.bottom, clip.bottom)
  if (right <= left || bottom <= top) return null
  return { left, top, right, bottom, width: right - left, height: bottom - top }
}

/**
 * V3.1 — outer gap (px) between the overlay frame border and the target box.
 * Table / Code / Figure / Formula = 2px breathing room; general block = 1px;
 * Heading = 0 (indicator only, no outer frame). Inline never uses a frame.
 */
export function diagnosticLocateFrameGapFor(kind: DiagnosticLocateTargetKind | null): number {
  if (kind === 'table' || kind === 'code' || kind === 'figure' || kind === 'formula') return 2
  if (kind === 'blockquote' || kind === 'block') return 1
  return 0 // heading + inline (no outer frame)
}

function inflateRect(rect: RectLike, gap: number): RectLike {
  if (gap <= 0) return rect
  return {
    left: rect.left - gap,
    top: rect.top - gap,
    right: rect.right + gap,
    bottom: rect.bottom + gap,
    width: rect.width + gap * 2,
    height: rect.height + gap * 2,
  }
}

/** Live anchor BCR as a rect snapshot (zeros on failure). */
function safeAnchorRect(el: HTMLElement): RectSnapshot {
  try {
    const r = el.getBoundingClientRect()
    if (Number.isFinite(r.left) && Number.isFinite(r.right)) {
      return makeRectSnapshot({ left: r.left, top: r.top, right: r.right, bottom: r.bottom })
    }
  } catch { /* fall through */ }
  return makeRectSnapshot({ left: 0, top: 0, right: 0, bottom: 0 })
}

/** Merge a caption/name host box (above the object) into the semantic rect. */
function mergeCaptionHost(
  rect: RectSnapshot,
  caption: { left: number; top: number; right: number; bottom: number } | null,
): RectSnapshot {
  if (!caption || !Number.isFinite(caption.left) || !Number.isFinite(caption.bottom)) return rect
  if (caption.bottom > rect.top + 0.5) return rect // caption not above the object
  return makeRectSnapshot({
    left: Math.min(rect.left, caption.left),
    top: Math.min(rect.top, caption.top),
    right: Math.max(rect.right, caption.right),
    bottom: rect.bottom,
  })
}

/**
 * Phase 7R.3.11.8B.8 — SINGLE Diagnostic Locate Frame controller.
 *
 * The host owns ONE instance per overlay host. The controller owns at most ONE
 * frame element + at most ONE inline mark. All visual writes are confined to
 * the overlay root (frame) or to the single resolved inline element (mark).
 */
export class DiagnosticLocateFrameController {
  private frameEl: HTMLDivElement | null = null
  private inlineEl: HTMLElement | null = null
  private anchorEl: HTMLElement | null = null
  private severity: DiagnosticLocateSeverity = 'info'
  private kind: DiagnosticLocateTargetKind | null = null
  private diagnosticId: string | null = null
  private rafHandle: number | null = null
  private disposed = false
  /** V3.1 — last committed frame geometry (px) + visibility, for audit/tests. */
  private lastFrameRect: { left: number; top: number; width: number; height: number } | null = null
  private frameVisible = false
  /** V4 — exact inline geometry / caption host / force-inline (from host). */
  private preciseRectOverride: { left: number; top: number; right: number; bottom: number } | null = null
  /** V5.12-R2 §10 — the exact source token whose TEXT RANGE is the inline visual. */
  private preciseTextPrefixOverride: string | null = null
  /** V5.12-R5 §8.2 — the verified token ordinal inside the resolved anchor. */
  private preciseOccurrenceWithinAnchor = 0
  private forceInlineMarkOverride = false
  private captionHostRectOverride: { left: number; top: number; right: number; bottom: number } | null = null
  /** V4 — last committed visual geometry decision (audit/tests). */
  private lastVisualPresentation: string | null = null
  private lastOcclusion: string | null = null
  private lastRectInvariantPass = true
  private lastSemanticRect: { left: number; top: number; right: number; bottom: number; width: number; height: number } | null = null
  /** V5.4 — geometry authority + coverage (never drawer/unobscured-clipped). */
  private lastRightEdgeAuthority: 'SEMANTIC_TARGET' | 'DRAWER_LEFT' | 'UNOBSCURED_EDITOR_RIGHT' = 'SEMANTIC_TARGET'
  private lastCoverage = { horizontal: 0, vertical: 0 }
  private lastVisibilityClipRect: { left: number; top: number; right: number; bottom: number; width: number; height: number } | null = null
  private lastFullyVisible = true
  /** V5.5 — scroll drift bookkeeping (viewport-space, absolute per repaint). */
  private lastScrollStabilityReport: {
    diagnosticId: string | null
    targetKind: string | null
    targetViewportTop: number
    frameViewportTop: number
    relativeOffsetY: number
    drift: number | null
    targetDeltaY: number | null
    frameDeltaY: number | null
    coordinateSpace: 'viewport'
    hostFresh: boolean
    expected: { left: number; top: number; right: number; bottom: number; width: number; height: number }
    painted: { left: number; top: number; right: number; bottom: number; width: number; height: number } | null
    committedWidth: number
    committedHeight: number
  } | null = null
  /** V5.7 — CommittedLocateVisualTopology frozen on the first paint. Pure
   *  repaint (scroll) refreshes left/top only and never re-derives
   *  presentation / size / border topology. */
  private committedPaint: {
    dx: number
    dy: number
    width: number
    height: number
    presentation: string
    openEdge: 'right' | 'left' | null
    radiusRight: boolean
  } | null = null
  private committedPresentation: string | null = null
  /** V5.12-R2 §5 — heading targets are carried by the heading marker, no frame. */
  private headingMarkerCarrier = false
  /** V5.12-R2 §10 — per-visual-line overlay fragments of an inline range. */
  private inlineFragmentEls: HTMLElement[] = []
  private lastInlineFragments: ClosureRect[] = []
  private lastInlineExpected: ClosureRect[] = []
  private lastInlineFragmentCoverage = 1
  private lastInlineCrossLineUnion = false
  // ── V5.12-R4 §8 — inline geometry generation / pre-scroll invalidation ────
  /** Bumped on EVERY real inline paint (a new, fresh measurement). */
  private inlineGeometryGeneration = 0
  /** Generation of the geometry the locator invalidated by writing scroll. */
  private inlineGenerationAtInvalidation: number | null = null
  /** True once a programmatic locate scroll made the pre-scroll range stale. */
  private preScrollInlineGeometryInvalidated = false
  /** True when a paint happened AFTER the invalidation (fresh geometry). */
  private postScrollInlineGeometryFresh = false
  private inlineInvalidationReason: string | null = null
  /** The scroll offset the current inline geometry was measured at. */
  private inlineMeasuredScrollTop: number | null = null
  private lastHeadingLegacyFrameRender = false

  constructor(private readonly root: HTMLElement | null) {}

  isActive(): boolean {
    return this.anchorEl !== null && this.anchorEl.isConnected
  }

  /** True while ANY visual state exists (frame / inline mark / anchor). */
  hasCommitted(): boolean {
    return this.frameEl !== null || this.inlineEl !== null || this.anchorEl !== null
  }

  getActiveDiagnosticId(): string | null {
    return this.diagnosticId
  }

  getFrameElement(): HTMLDivElement | null {
    return this.frameEl
  }

  getInlineElement(): HTMLElement | null {
    return this.inlineEl
  }

  /** V5.11 — the committed semantic anchor (document-space identity source). */
  getAnchorElement(): HTMLElement | null {
    return this.anchorEl
  }

  /**
   * V5.11 — detach ONLY the viewport carrier element. The committed identity
   * (anchor / kind / severity / presentation) is preserved so the
   * document-space carrier can take over without a re-resolve.
   */
  releaseViewportCarrier(): HTMLDivElement | null {
    const el = this.frameEl
    if (!el) return null
    try { el.remove() } catch { /* noop */ }
    this.frameEl = null
    return el
  }

  getStructure(): DiagnosticLocateFrameStructure {
    const stale = this.anchorEl !== null && !this.anchorEl.isConnected
    return {
      locateFrameCount: this.frameEl ? 1 : 0,
      duplicateLocateFrame: false,
      staleLocateFrameCount: stale && this.frameEl ? 1 : 0,
      inlineMarkCount: this.inlineEl ? 1 : 0,
      duplicateInlineMark: false,
      active: this.isActive(),
      activeDiagnosticId: this.diagnosticId,
      kind: this.kind,
      severity: this.severity,
      headingMarkerCarrier: this.headingMarkerCarrier,
      inlineFragmentCount: this.inlineFragmentEls.length,
    }
  }

  /** V5.12-R2 §5 — did this commit ever paint a legacy heading block frame? */
  getHeadingLegacyFrameRender(): boolean {
    return this.lastHeadingLegacyFrameRender
  }

  /** V5.12-R2 §10 — inline fragment facts (audit / commit gate). */
  getInlineFragmentFacts(): {
    fragments: ClosureRect[]
    expected: ClosureRect[]
    coverage: number
    crossLineUnion: boolean
    paintedCarrierRect: ClosureRect | null
  } {
    return {
      fragments: [...this.lastInlineFragments],
      expected: [...this.lastInlineExpected],
      coverage: this.lastInlineFragmentCoverage,
      crossLineUnion: this.lastInlineCrossLineUnion,
      paintedCarrierRect: this.measureInlineFragmentBounds(),
    }
  }

  /**
   * Commit the locator result. Clears the previous visual first (click A then
   * B -> old frame/inline removed), then mounts the correct carrier.
   */
  commit(input: DiagnosticLocateVisualCommit): boolean {
    if (this.disposed) return false
    this.clear('NEW_LOCATE')
    // V5.12-R4 §8 — a NEW locate starts a fresh inline geometry generation.
    this.preScrollInlineGeometryInvalidated = false
    this.postScrollInlineGeometryFresh = false
    this.inlineGenerationAtInvalidation = null
    this.inlineInvalidationReason = null
    const { anchor, severity, diagnosticId } = input
    if (!anchor || !anchor.isConnected) return false
    const kind = input.kind ?? classifyDiagnosticLocateElement(anchor)
    this.anchorEl = anchor
    this.severity = severity
    this.kind = kind
    this.diagnosticId = diagnosticId
    this.preciseRectOverride = input.preciseRect ?? null
    this.preciseTextPrefixOverride = input.preciseTextPrefix ?? null
    this.preciseOccurrenceWithinAnchor = Math.max(0, Math.floor(input.preciseOccurrenceWithinAnchor ?? 0))
    this.forceInlineMarkOverride = input.forceInlineMark === true
    this.captionHostRectOverride = input.captionHostRect ?? null
    // ── V5.12-R2 §5/§4 — HEADING: scroll authority ≠ visual authority. ──────
    // The heading's block rect stays the SCROLL / visibility authority, but the
    // visual carrier is the TEXT-TIGHT heading marker (passive + active), which
    // the host paints. NO legacy full-width block frame is ever mounted.
    if (kind === 'heading') {
      this.headingMarkerCarrier = true
      this.lastHeadingLegacyFrameRender = false
      this.lastVisualPresentation = 'text-tight-marker'
      this.lastOcclusion = 'none'
      this.lastRectInvariantPass = true
      this.lastRightEdgeAuthority = 'SEMANTIC_TARGET'
      this.lastCoverage = { horizontal: 1, vertical: 1 }
      this.lastVisibilityClipRect = null
      const ar = safeAnchorRect(anchor)
      this.lastSemanticRect = { left: ar.left, top: ar.top, right: ar.right, bottom: ar.bottom, width: ar.width, height: ar.height }
      // The visual is NOT this controller's frame → it is never "frame visible";
      // the heading marker layer owns visibility.
      this.frameVisible = false
      this.lastFrameRect = null
      return true
    }
    // ── V5.12-R2 §10 — INLINE SOURCE RANGE (exact, per visual line) ─────────
    // An EXACT source range (L1 raw destination token / L2 source-line marker) is
    // an INLINE visual target with per-visual-line fragments — never a block
    // frame, never a cross-line union. The L3 owning-block fallback (no exact
    // range could be established) keeps the legacy corner-marked block carrier.
    const inlineExactAvailable = this.forceInlineMarkOverride && this.preciseRectOverride != null
    if (kind === 'inline' || inlineExactAvailable) {
      this.kind = 'inline'
      // V5.12-R2 §10/§15 — an inline carrier IS a committed presentation, so the
      // presentation kind + coverage are declared here (they were only ever set
      // by a frame reposition before, which an inline target never runs).
      this.lastVisualPresentation = 'inline-mark'
      this.lastOcclusion = 'none'
      this.lastRectInvariantPass = true
      this.lastRightEdgeAuthority = 'SEMANTIC_TARGET'
      this.lastCoverage = { horizontal: 1, vertical: 1 }
      const ar = safeAnchorRect(anchor)
      this.lastSemanticRect = { left: ar.left, top: ar.top, right: ar.right, bottom: ar.bottom, width: ar.width, height: ar.height }
      // §10 — the EXACT source range is painted as per-line overlay fragments.
      this.paintInlineFragments(anchor)
      // Without a measurable exact range the element-carried class mark is the
      // carrier (never a block frame).
      if (this.inlineFragmentEls.length === 0) this.applyInlineMark(anchor)
      return true
    }
    this.mountFrame(kind)
    this.reposition()
    return true
  }

  /** §10 — the exact source-range geometry as one overlay child per visual line. */
  private paintInlineFragments(anchor: HTMLElement): void {
    this.removeInlineFragments()
    const raw = this.preciseRectOverride
    if (!raw) return
    // V5.12-R2 §10 (runtime closure) — measure the EXACT source token's text
    // range so a wrapped token yields ONE FRAGMENT PER VISUAL LINE. Measuring
    // the owning element instead would return a single block-sized rect (a
    // forbidden cross-line union covering the full text column).
    const measured = measureTextFragmentRects(
      anchor,
      this.preciseTextPrefixOverride,
      this.preciseOccurrenceWithinAnchor,
    )
    // Only the EXACT source-range fragments may be painted; without a
    // measurable range the class-based inline mark stays the carrier.
    if (measured.expected.length === 0 || measured.fragments.length === 0) return
    if (!this.root) return
    for (const f of measured.fragments) {
      const el = document.createElement('div')
      el.className = DIAGNOSTIC_INLINE_FRAGMENT_CLASS
      el.setAttribute('data-severity', this.severity)
      el.setAttribute('data-target-kind', 'inline')
      el.setAttribute('aria-hidden', 'true')
      el.style.cssText = `position:absolute;left:${Math.round(f.left)}px;top:${Math.round(f.top)}px;width:${Math.round(f.width)}px;height:${Math.round(f.height)}px;pointer-events:none;`
      this.root.appendChild(el)
      this.inlineFragmentEls.push(el)
    }
    this.lastInlineExpected = []
    for (const r of measured.expected) {
      this.lastInlineExpected.push({ left: r.left, top: r.top, right: r.right, bottom: r.bottom, width: r.width, height: r.height })
    }
    this.lastInlineFragments = measured.fragments
    this.inlineGeometryGeneration++
    this.inlineMeasuredScrollTop = this.currentScrollTop()
    // §7.1/§8 — a paint AFTER the programmatic-scroll invalidation is the FRESH
    // (post-scroll) geometry the terminal COMMIT is allowed to use.
    if (this.preScrollInlineGeometryInvalidated) this.postScrollInlineGeometryFresh = true
    this.lastInlineFragmentCoverage = fragmentCoverageRatio(measured.expected, measured.fragments)
    this.lastInlineCrossLineUnion = hasCrossLineUnion(measured.expected, measured.fragments)
  }

  /** §7.1/§8 — a programmatic locate scroll INVALIDATES the pre-scroll range. */
  invalidateInlineGeometry(reason: string): void {
    this.inlineGenerationAtInvalidation = this.inlineGeometryGeneration
    this.preScrollInlineGeometryInvalidated = true
    this.postScrollInlineGeometryFresh = false
    this.inlineInvalidationReason = reason
    // The stale pre-scroll fragments must never survive into the final paint.
    this.removeInlineFragments()
  }

  /**
   * V5.12-R4 §19 — re-measure the source Range WITHOUT painting a viewport
   * carrier. Used by the post-COMMIT layout reflow (drawer width change /
   * resize / DevTools dock) where the DOCUMENT-SPACE fragments are repositioned
   * by the host instead of a viewport repaint.
   */
  remeasureInlineGeometry(): { fragments: ClosureRect[]; expected: ClosureRect[] } {
    const anchor = this.anchorEl
    if (!anchor || !anchor.isConnected || !this.preciseRectOverride) {
      return { fragments: [...this.lastInlineFragments], expected: [...this.lastInlineExpected] }
    }
    const measured = measureTextFragmentRects(
      anchor,
      this.preciseTextPrefixOverride,
      this.preciseOccurrenceWithinAnchor,
    )
    if (measured.expected.length === 0 || measured.fragments.length === 0) {
      return { fragments: [...this.lastInlineFragments], expected: [...this.lastInlineExpected] }
    }
    this.lastInlineExpected = measured.expected.map(r => ({
      left: r.left, top: r.top, right: r.right, bottom: r.bottom, width: r.width, height: r.height,
    }))
    this.lastInlineFragments = measured.fragments
    this.inlineGeometryGeneration++
    this.inlineMeasuredScrollTop = this.currentScrollTop()
    this.lastInlineFragmentCoverage = fragmentCoverageRatio(measured.expected, measured.fragments)
    this.lastInlineCrossLineUnion = hasCrossLineUnion(measured.expected, measured.fragments)
    return { fragments: [...measured.fragments], expected: [...this.lastInlineExpected] }
  }

  /**
   * §3/§14 — detach the VIEWPORT inline carrier at COMMIT. The measured geometry
   * (viewport fragments / expected) is preserved for the document-space
   * conversion + audit; only the private viewport render path is removed.
   */
  releaseViewportInlineCarrier(): boolean {
    const had = this.inlineFragmentEls.length > 0
    for (const el of this.inlineFragmentEls) {
      try { el.remove() } catch { /* noop */ }
    }
    this.inlineFragmentEls = []
    if (this.inlineEl) this.removeInlineMark(this.inlineEl)
    this.inlineEl = null
    return had
  }

  /** §8/§14 — inline document-space coordinate facts (audit + commit gate). */
  getInlineCoordinateFacts(): {
    generation: number
    preScrollGeometryInvalidated: boolean
    postScrollGeometryFresh: boolean
    invalidationReason: string | null
    generationAtInvalidation: number | null
    measuredScrollTop: number | null
    /** §9/§25 — an EXACT source range really exists (the gate only applies then). */
    exactInlinePresent: boolean
    /** Grouped per-visual-line fragments (the final visual authority). */
    viewportFragments: ClosureRect[]
    /** Raw meaningful Range client rects (viewport space). */
    expectedViewportRects: ClosureRect[]
    paintedFragmentElementCount: number
    /** Real painted overlay rects (viewport space; empty in headless). */
    paintedViewportRects: ClosureRect[]
  } {
    return {
      generation: this.inlineGeometryGeneration,
      preScrollGeometryInvalidated: this.preScrollInlineGeometryInvalidated,
      postScrollGeometryFresh: this.postScrollInlineGeometryFresh,
      invalidationReason: this.inlineInvalidationReason,
      generationAtInvalidation: this.inlineGenerationAtInvalidation,
      measuredScrollTop: this.inlineMeasuredScrollTop,
      exactInlinePresent: this.preciseRectOverride != null,
      viewportFragments: [...this.lastInlineFragments],
      expectedViewportRects: [...this.lastInlineExpected],
      paintedFragmentElementCount: this.inlineFragmentEls.length,
      paintedViewportRects: this.measureInlineFragmentElementRects(),
    }
  }

  /** §11 — the REAL painted overlay rects (viewport space) of the fragments. */
  measureInlineFragmentElementRects(): ClosureRect[] {
    const out: ClosureRect[] = []
    for (const el of this.inlineFragmentEls) {
      if (!el.isConnected) continue
      let r: DOMRect
      try { r = el.getBoundingClientRect() } catch { continue }
      if (!Number.isFinite(r.left) || !Number.isFinite(r.top)) continue
      if (r.width <= 0 && r.height <= 0) continue
      out.push({ left: r.left, top: r.top, right: r.right, bottom: r.bottom, width: r.width, height: r.height })
    }
    return out
  }

  private currentScrollTop(): number | null {
    const scroller = this.root?.ownerDocument?.scrollingElement as HTMLElement | null
    if (scroller && Number.isFinite(scroller.scrollTop)) return scroller.scrollTop
    return null
  }

  private removeInlineFragments(): void {
    for (const el of this.inlineFragmentEls) {
      try { el.remove() } catch { /* noop */ }
    }
    this.inlineFragmentEls = []
    this.lastInlineFragments = []
    this.lastInlineExpected = []
    this.lastInlineFragmentCoverage = 1
    this.lastInlineCrossLineUnion = false
  }

  /** The painted union of the per-line fragments (null when none). */
  private measureInlineFragmentBounds(): ClosureRect | null {
    if (this.inlineFragmentEls.length === 0) return null
    let l = Infinity
    let t = Infinity
    let r = -Infinity
    let b = -Infinity
    for (const el of this.inlineFragmentEls) {
      const left = Number.parseFloat(el.style.left)
      const top = Number.parseFloat(el.style.top)
      const w = Number.parseFloat(el.style.width)
      const h = Number.parseFloat(el.style.height)
      if (![left, top, w, h].every(Number.isFinite)) continue
      l = Math.min(l, left)
      t = Math.min(t, top)
      r = Math.max(r, left + w)
      b = Math.max(b, top + h)
    }
    if (!Number.isFinite(l) || !Number.isFinite(t)) return null
    return { left: l, top: t, right: r, bottom: b, width: r - l, height: b - t }
  }

  /** V4 — last committed presentation / occlusion / semantic rect (audit/tests). */
  getVisualPresentation(): string | null {
    return this.lastVisualPresentation
  }

  getVisualOcclusion(): string | null {
    return this.lastOcclusion
  }

  getRectInvariantPass(): boolean {
    return this.lastRectInvariantPass
  }

  getSemanticRect(): { left: number; top: number; right: number; bottom: number; width: number; height: number } | null {
    return this.lastSemanticRect
  }

  /** V5.4 — full geometry authority report (semantic / presentation /
   *  visibility clip / right-edge authority / coverage). */
  getGeometryReport(): {
    semanticRect: { left: number; top: number; right: number; bottom: number; width: number; height: number } | null
    presentationRect: { left: number; top: number; width: number; height: number } | null
    visibilityClipRect: { left: number; top: number; right: number; bottom: number; width: number; height: number } | null
    rightEdgeAuthority: 'SEMANTIC_TARGET' | 'DRAWER_LEFT' | 'UNOBSCURED_EDITOR_RIGHT'
    horizontalCoverage: number
    verticalCoverage: number
    fullyVisible: boolean
  } {
    return {
      semanticRect: this.lastSemanticRect,
      presentationRect: this.lastFrameRect,
      visibilityClipRect: this.lastVisibilityClipRect,
      rightEdgeAuthority: this.lastRightEdgeAuthority,
      horizontalCoverage: this.lastCoverage.horizontal,
      verticalCoverage: this.lastCoverage.vertical,
      fullyVisible: this.lastFullyVisible,
    }
  }

  /** V5.5 — last scroll-drift report (used by the host scroll stability audit). */
  getLastScrollStabilityReport(): {
    diagnosticId: string | null
    targetKind: string | null
    targetViewportTop: number
    frameViewportTop: number
    relativeOffsetY: number
    drift: number | null
    targetDeltaY: number | null
    frameDeltaY: number | null
    coordinateSpace: 'viewport'
    hostFresh: boolean
    expected: { left: number; top: number; right: number; bottom: number; width: number; height: number }
    painted: { left: number; top: number; right: number; bottom: number; width: number; height: number } | null
    committedWidth: number
    committedHeight: number
  } | null {
    return this.lastScrollStabilityReport
  }

  /**
   * Reposition the frame onto the current live anchor rect. Only a pure
   * rect->style write: no DOM query, no relocation. `clipRect` is the visible
   * editor region the host already resolved (drawer-unobscured when open).
   *
   * V4 — semantic (real object) vs presentation (drawable now) are kept
   * separate by buildLocateVisualGeometryV4. Drawer occlusion becomes an
   * OPEN-EDGE presentation (no fake closed clipped rectangle).
   */
  reposition(opts?: { clipRect?: RectLike | null; headless?: boolean; drawerRect?: RectLike | null; preciseRect?: RectLike | null; scroll?: boolean }): void {
    if (this.disposed) return
    if (this.anchorEl && !this.anchorEl.isConnected) {
      this.clear('ANCHOR_DISCONNECTED')
      return
    }
    // ── V5.12-R4 §3/§7.1 — the exact-fragment inline carrier owns NO frame ────
    // element, so `reposition()` used to early-return and the fragments measured
    // during `commit()` (PRE-scroll viewport geometry) survived to COMMIT —
    // exactly the "deltaTop ≈ scrollWriteDistance" defect. A reposition MUST
    // re-measure the source Range in the CURRENT scroll state instead.
    if (!this.frameEl && this.kind === 'inline' && this.anchorEl?.isConnected) {
      if (this.preciseRectOverride) this.paintInlineFragments(this.anchorEl)
      return
    }
    const frame = this.frameEl
    if (!frame || !this.anchorEl) return
    const headless = opts?.headless === true
    const precise = opts?.preciseRect ?? this.preciseRectOverride
    const anchorRect = safeAnchorRect(this.anchorEl)
    // V4 — semantic rect: exact inline geometry when provided, else the
    // inflated real object box. The object box may be widened up to the
    // caption / expected-name host so the caption keyline sits inside the frame.
    const semanticSource = precise ? makeRectSnapshot(precise) : anchorRect
    const gap = precise || this.forceInlineMarkOverride ? 0 : diagnosticLocateFrameGapFor(this.kind)
    const inflated = inflateRectBy(semanticSource, gap)
    const caption = this.captionHostRectOverride
    const withCaption = mergeCaptionHost(inflated, caption)
    // Heading — measure the REAL text extent for the text-tight bottom edge
    // (never a full-width heading border). Headless keeps the semantic box.
    let headingTextRight = 0
    if (this.kind === 'heading' && !headless && caption == null) {
      const txt = measureTextRects(this.anchorEl)
      if (txt.exact) headingTextRight = txt.exact.right - withCaption.left
    }
    const geo = buildLocateVisualGeometryV4({
      kind: (this.kind === 'heading' || this.kind === 'inline' ? this.kind : this.kind ?? 'block') as Parameters<typeof buildLocateVisualGeometryV4>[0]['kind'],
      semanticRect: withCaption,
      unobscuredRect: opts?.clipRect ?? null,
      drawerRect: opts?.drawerRect ?? null,
      headless,
      forceInlineMark: this.forceInlineMarkOverride,
    })
    let present = geo.presentationRect
    // V5.7 — CommittedLocateVisualTopology: after the FIRST successful paint the
    // presentation/roles/anchor are FROZEN. Pure repaint (scroll etc.) only
    // refreshes left/top from the fresh anchor rect and reuses the committed
    // width/height/presentation/border — a scroll can never re-derive the
    // presentation (full-frame → open-right-frame) nor resize the block.
    let cp = this.committedPaint
    if (present && present.width > 0 && present.height > 0) {
      if (opts?.scroll === true && cp !== null) {
        // V5.7 — PURE SCROLL: the CommittedLocateVisualTopology is frozen. Only
        // left/top are refreshed from the FRESH anchor rect; presentation /
        // width / height / border can never be re-derived by a scroll.
        const targetLeft = anchorRect.left
        const targetTop = anchorRect.top
        const fLeft = targetLeft + cp.dx
        const fTop = targetTop + cp.dy
        present = {
          x: fLeft,
          y: fTop,
          left: fLeft,
          top: fTop,
          right: fLeft + cp.width,
          bottom: fTop + cp.height,
          width: cp.width,
          height: cp.height,
        }
        this.lastVisualPresentation = cp.presentation
      } else {
        // Commit / first paint / drawer-change / resize: re-derive the topology
        // from the current geometry (NOT a scroll — this is how an occlusion or
        // size change legitimately updates the presentation).
        cp = {
          dx: present.left - anchorRect.left,
          dy: present.top - anchorRect.top,
          width: present.width,
          height: present.height,
          presentation: geo.presentation,
          openEdge: geo.borderRendered.right === false ? 'right' : geo.borderRendered.left === false ? 'left' : null,
          radiusRight: geo.radius.topRight === 0,
        }
        this.committedPaint = cp
        this.committedPresentation = geo.presentation
      }
    }
    this.lastSemanticRect = { left: withCaption.left, top: withCaption.top, right: withCaption.right, bottom: withCaption.bottom, width: withCaption.width, height: withCaption.height }
    this.lastVisualPresentation = cp ? cp.presentation : (this.lastVisualPresentation ?? geo.presentation)
    this.lastOcclusion = geo.occlusion.length > 0 ? geo.occlusion.join(',') : 'none'
    this.lastRectInvariantPass = geo.rectInvariantPass
    // V5.4 — geometry authority + coverage stay on the full semantic box.
    this.lastRightEdgeAuthority = geo.rightEdgeAuthority
    this.lastCoverage = { horizontal: geo.coverage.horizontal, vertical: geo.coverage.vertical }
    this.lastVisibilityClipRect = geo.visibilityClipRect
      ? { left: geo.visibilityClipRect.left, top: geo.visibilityClipRect.top, right: geo.visibilityClipRect.right, bottom: geo.visibilityClipRect.bottom, width: geo.visibilityClipRect.width, height: geo.visibilityClipRect.height }
      : null
    this.lastFullyVisible = geo.fullyVisible
    if (!present || present.width <= 0 || present.height <= 0) {
      this.frameVisible = false
      this.lastFrameRect = null
      frame.style.display = 'none'
      return
    }
    this.frameVisible = true
    this.lastFrameRect = { left: present.left, top: present.top, width: present.width, height: present.height }
    frame.dataset.presentation = cp ? cp.presentation : geo.presentation
    frame.dataset.occlusion = this.lastOcclusion
    frame.dataset.fullyVisible = String(geo.fullyVisible)
    if (cp) {
      if (cp.openEdge === 'right') frame.dataset.openEdge = 'right'
      else if (cp.openEdge === 'left') frame.dataset.openEdge = 'left'
      else frame.removeAttribute('data-open-edge')
      if (cp.radiusRight) frame.dataset.openRadius = 'right'
      else frame.removeAttribute('data-open-radius')
    } else if (geo.borderRendered.right === false) frame.dataset.openEdge = 'right'
    else if (geo.borderRendered.left === false) frame.dataset.openEdge = 'left'
    else frame.removeAttribute('data-open-edge')
    if (cp === null) {
      if (geo.radius.topRight === 0) frame.dataset.openRadius = 'right'
      else frame.removeAttribute('data-open-radius')
    }
    // V5.5 — ONE viewport → overlay-host-local conversion at paint time. The
    // overlay host rect is measured FRESH in the same rAF as the target rect.
    // Absolute write only — never oldRect += delta / -= scrollTop.
    let hostL = 0
    let hostT = 0
    let hostFresh = false
    if (!headless && this.root && this.root.isConnected) {
      try {
        const hr = this.root.getBoundingClientRect()
        if (Number.isFinite(hr.left) && Number.isFinite(hr.top)) {
          hostL = hr.left
          hostT = hr.top
          // A zero host rect (jsdom / not laid out) does not prove a real
          // overlay layout, so drift reports fall back to the semantic top.
          // V5.8 — regression-gate correction: the overlay root is a
          // FULL-VIEWPORT fixed layer anchored at (0,0), so `left/top !== 0` is
          // NOT a valid "measured" heuristic — it was permanently false in real
          // Typora and produced FRESH_HOST_MEASUREMENT_FALSE on every scroll
          // repaint. A real laid-out root has non-zero SIZE; a not-laid-out
          // jsdom root stays 0×0 and still reports false.
          hostFresh = hr.left !== 0 || hr.top !== 0 || hr.width > 0 || hr.height > 0
        }
      } catch { /* keep zero host */ }
    }
    frame.style.display = 'block'
    frame.style.left = `${Math.round(present.left - hostL)}px`
    frame.style.top = `${Math.round(present.top - hostT)}px`
    frame.style.width = `${Math.round(present.width)}px`
    frame.style.height = `${Math.round(present.height)}px`
    // Caption / expected-name keyline — drawn INSIDE the frame (single child,
    // removed together with the frame; count invariant <=1 preserved).
    this.syncCaptionCue(frame, present, withCaption, caption)
    // V5 — heading corner cap is 10–16px (never a whole-text underline).
    if (this.kind === 'heading' && headingTextRight > 0) {
      const corner = Math.max(10, Math.min(16, Math.round(headingTextRight - 6)))
      frame.style.setProperty('--ink-heading-corner', `${corner}px`)
    }
    // V5.5 — drift report (viewport space; absolute per repaint).
    if (present.height > 0) {
      let frameViewportTop = present.top
      let painted: { left: number; top: number; right: number; bottom: number; width: number; height: number } | null = null
      // Only a real overlay layout (nonzero host rect) can report a measured
      // frame BCR; otherwise fall back to the semantic top for headless/tests.
      if (!headless && hostFresh) {
        try {
          const fv = frame.getBoundingClientRect()
          if (Number.isFinite(fv.top) && fv.top !== 0) {
            frameViewportTop = fv.top
            painted = { left: fv.left, top: fv.top, right: fv.right, bottom: fv.bottom, width: fv.width, height: fv.height }
          }
        } catch { /* fall back to present.top */ }
      }
      const prev = this.lastScrollStabilityReport
      const targetViewportTop = withCaption.top
      const relativeOffsetY = frameViewportTop - targetViewportTop
      const expected = {
        left: present.left, top: present.top, right: present.right,
        bottom: present.bottom, width: present.width, height: present.height,
      }
      this.lastScrollStabilityReport = {
        diagnosticId: this.diagnosticId,
        targetKind: this.kind,
        targetViewportTop,
        frameViewportTop,
        relativeOffsetY,
        drift: prev ? Math.abs(relativeOffsetY - prev.relativeOffsetY) : null,
        targetDeltaY: prev ? targetViewportTop - prev.targetViewportTop : null,
        frameDeltaY: prev ? frameViewportTop - prev.frameViewportTop : null,
        coordinateSpace: 'viewport',
        hostFresh,
        expected,
        painted,
        committedWidth: cp?.width ?? present.width,
        committedHeight: cp?.height ?? present.height,
      }
    }
  }

  /** V3.1 — last committed frame rect (style space, px) for runtime audit. */
  getFrameRect(): { left: number; top: number; width: number; height: number } | null {
    return this.lastFrameRect
  }

  isFrameVisible(): boolean {
    return this.frameVisible
  }

  getFrameGap(): number {
    return diagnosticLocateFrameGapFor(this.kind)
  }

  /** rAF-coalesced reposition — used for scroll/resize/geometry events. */
  scheduleReposition(opts?: { clipRect?: RectLike | null; headless?: boolean }): void {
    if (this.disposed || this.rafHandle !== null) return
    const run = (): void => {
      this.rafHandle = null
      this.reposition(opts)
    }
    if (typeof requestAnimationFrame === 'function') {
      try {
        this.rafHandle = requestAnimationFrame(run)
        return
      } catch { /* fall through to sync */ }
    }
    run()
  }

  /** Remove the active visual (frame + inline mark) without touching the root. */
  clear(reason?: string): void {
    if (this.rafHandle !== null) {
      if (typeof cancelAnimationFrame === 'function') {
        try { cancelAnimationFrame(this.rafHandle) } catch { /* noop */ }
      }
      this.rafHandle = null
    }
    if (this.frameEl) {
      try { this.frameEl.remove() } catch { /* noop */ }
      this.frameEl = null
    }
    if (this.inlineEl) {
      this.removeInlineMark(this.inlineEl)
      this.inlineEl = null
    }
    this.removeInlineFragments()
    this.anchorEl = null
    this.kind = null
    this.diagnosticId = null
    this.severity = 'info'
    this.lastFrameRect = null
    this.frameVisible = false
    this.headingMarkerCarrier = false
    this.lastHeadingLegacyFrameRender = false
    this.preciseRectOverride = null
    this.preciseTextPrefixOverride = null
    this.preciseOccurrenceWithinAnchor = 0
    this.forceInlineMarkOverride = false
    this.captionHostRectOverride = null
    this.lastVisualPresentation = null
    this.lastOcclusion = null
    this.lastRectInvariantPass = true
    this.lastSemanticRect = null
    this.committedPaint = null
    this.committedPresentation = null
    this.lastScrollStabilityReport = null
  }

  dispose(): void {
    this.disposed = true
    this.clear('DISPOSE')
  }

  // ── private ────────────────────────────────

  private ensureFrameEl(): HTMLDivElement {
    if (this.frameEl) return this.frameEl
    const el = document.createElement('div')
    el.className = DIAGNOSTIC_LOCATE_FRAME_CLASS
    // Hidden until a target is committed.
    el.style.display = 'none'
    if (this.root && this.root.firstChild) {
      // Under toolbar/navigator/drawer so the panel surfaces stay on top.
      this.root.insertBefore(el, this.root.firstChild)
    } else if (this.root) {
      this.root.appendChild(el)
    }
    this.frameEl = el
    return el
  }

  private mountFrame(kind: Exclude<DiagnosticLocateTargetKind, 'inline'>): void {
    const el = this.ensureFrameEl()
    el.setAttribute('data-severity', this.severity)
    el.setAttribute('data-target-kind', kind)
  }

  /** V4/V5.2 — caption / expected-name PRIMARY slot, ONE child inside the frame
   *  (count invariant <=1). When a measured name-slot (caption host) exists the
   *  child is a compact slot FILL (stronger than the secondary context frame);
   *  without one it is a thin top-edge keyline. Removed with the frame. */
  private syncCaptionCue(
    frame: HTMLDivElement,
    present: { left: number; top: number; width: number; height: number },
    semantic: RectSnapshot,
    caption: { left: number; top: number; right: number; bottom: number } | null,
  ): void {
    const old = frame.querySelector<HTMLElement>(`:scope > .${DIAGNOSTIC_LOCATE_CAPTION_CUE_CLASS}`)
    if (old) old.remove()
    frame.removeAttribute('data-caption-cue')
    if (this.kind !== 'table' && this.kind !== 'code') return
    const cueType = caption ? 'caption-host' : 'top-edge'
    const relLeftRaw = caption ? caption.left - present.left : semantic.left - present.left + 2
    const relTopRaw = caption ? caption.top - present.top : 3
    let cueWidth = caption ? Math.max(12, caption.right - caption.left) : Math.min(64, present.width - 8)
    if (relLeftRaw < -2 || relTopRaw < -2 || relTopRaw > present.height + 2 || cueWidth < 6) return
    const maxW = present.width - Math.max(relLeftRaw, 0) - 2
    if (maxW < 6) return
    cueWidth = Math.min(cueWidth, maxW)
    const cue = document.createElement('div')
    cue.className = DIAGNOSTIC_LOCATE_CAPTION_CUE_CLASS
    cue.setAttribute('data-marker-kind', 'caption-edge')
    cue.setAttribute('data-cue-type', cueType)
    cue.setAttribute('data-severity', this.severity)
    cue.style.left = `${Math.round(Math.max(relLeftRaw, 0))}px`
    cue.style.top = `${Math.round(Math.max(relTopRaw, 0))}px`
    cue.style.width = `${Math.round(cueWidth)}px`
    if (caption) {
      // V5.2 — the primary name slot is a compact fill whose bottom carries the
      // strong keyline (see ::after). Height = measured slot height (min 12px),
      // clamped so it never exceeds the visible frame.
      const slotTop = Math.max(relTopRaw, 0)
      const slotH = Math.max(12, Math.min(caption.bottom - caption.top, present.height - slotTop - 2))
      cue.style.height = `${Math.round(slotH)}px`
    } else {
      cue.style.height = '2px'
    }
    frame.appendChild(cue)
    frame.setAttribute('data-caption-cue', caption ? 'caption-host' : 'top-edge')
  }

  private applyInlineMark(el: HTMLElement): void {
    el.classList.add(DIAGNOSTIC_INLINE_MARK_CLASS)
    el.setAttribute('data-severity', this.severity)
    el.setAttribute('data-target-kind', 'inline')
    this.inlineEl = el
  }

  private removeInlineMark(el: HTMLElement): void {
    el.classList.remove(DIAGNOSTIC_INLINE_MARK_CLASS)
    el.removeAttribute('data-severity')
    el.removeAttribute('data-target-kind')
  }
}
