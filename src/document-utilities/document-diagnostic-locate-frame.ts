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
    }
  }

  /**
   * Commit the locator result. Clears the previous visual first (click A then
   * B -> old frame/inline removed), then mounts the correct carrier.
   */
  commit(input: DiagnosticLocateVisualCommit): boolean {
    if (this.disposed) return false
    this.clear('NEW_LOCATE')
    const { anchor, severity, diagnosticId } = input
    if (!anchor || !anchor.isConnected) return false
    const kind = input.kind ?? classifyDiagnosticLocateElement(anchor)
    this.anchorEl = anchor
    this.severity = severity
    this.kind = kind
    this.diagnosticId = diagnosticId
    if (kind === 'inline') {
      this.applyInlineMark(anchor)
      return true
    }
    this.mountFrame(kind)
    this.reposition()
    return true
  }

  /**
   * Reposition the frame onto the current live anchor rect. Only a pure
   * rect->style write: no DOM query, no relocation. `clipRect` is the visible
   * editor region the host already resolved (drawer-unobscured when open).
   * Headless test environments have no real layout -> clipping is skipped.
   */
  reposition(opts?: { clipRect?: RectLike | null; headless?: boolean }): void {
    if (this.disposed) return
    if (this.anchorEl && !this.anchorEl.isConnected) {
      this.clear('ANCHOR_DISCONNECTED')
      return
    }
    const frame = this.frameEl
    if (!frame || !this.anchorEl) return
    let rect: RectLike
    try {
      const r = this.anchorEl.getBoundingClientRect()
      rect = { left: r.left, top: r.top, right: r.right, bottom: r.bottom, width: r.right - r.left, height: r.bottom - r.top }
    } catch {
      rect = { left: 0, top: 0, right: 0, bottom: 0, width: 0, height: 0 }
    }
    const headless = opts?.headless === true
    const clip = opts?.clipRect ?? null
    let target: RectLike = rect
    if (!headless && clip) {
      const clipped = clampRect(rect, clip)
      if (!clipped) {
        frame.style.display = 'none'
        return
      }
      target = clipped
    }
    frame.style.display = 'block'
    frame.style.left = `${Math.round(target.left)}px`
    frame.style.top = `${Math.round(target.top)}px`
    frame.style.width = `${Math.round(target.width)}px`
    frame.style.height = `${Math.round(target.height)}px`
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
    this.anchorEl = null
    this.kind = null
    this.diagnosticId = null
    this.severity = 'info'
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
