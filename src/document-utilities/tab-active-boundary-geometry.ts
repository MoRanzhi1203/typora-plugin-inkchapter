/**
 * Tab Active Boundary Geometry V5.8 — the MINIMAL Active-Tab geometry sync.
 *
 * WHY THIS EXISTS
 * ---------------
 * The tab bar's final vertical order is fixed:
 *
 *     tab content -> native horizontal scrollbar -> 2~3px internal gap
 *                 -> 1px bottom boundary -> editor body
 *
 * and the bottom boundary must be CUT OUT under the ACTIVE tab while the bar is
 * at rest, then restored while the bar is hovered.
 *
 * REAL DOM (framework `packages/core/src/ui/components/tabs.ts`):
 * `.typ-tabs-wrapper` and `.typ-workspace-tab-header` are the SAME element —
 * `containerEl = <div class="typ-tabs-wrapper typ-workspace-tab-header">` — so
 * "Header" is NOT an outer shell around the scroll owner; it IS the scroll owner.
 * The boundary is therefore painted by that element itself, and the ACTIVE
 * cut-out lives in exactly the same coordinate space (the wrapper's border box).
 * A pure-CSS cut-out is impossible there (the active tab's x-range is unknowable
 * from the boundary's own element), so this controller measures it.
 *
 * SCOPE — this class owns NOTHING but that geometry:
 *   bind / unbind / scheduleSync / syncGeometry
 * It never selects the active tab (the framework does), never opens/closes tabs,
 * never drags/reorders, never scrolls, never touches the scrollbar, and keeps no
 * document/diagnostic state. It writes exactly two CSS custom properties:
 *   --ink-active-tab-cut-left
 *   --ink-active-tab-cut-width
 */

export const TAB_ACTIVE_BOUNDARY_CUT_LEFT_VAR = '--ink-active-tab-cut-left'
export const TAB_ACTIVE_BOUNDARY_CUT_WIDTH_VAR = '--ink-active-tab-cut-width'

export const TAB_ACTIVE_BOUNDARY_WRAPPER_SELECTOR = '.typ-tabs-wrapper'
export const TAB_ACTIVE_BOUNDARY_ACTIVE_SELECTOR = '.typ-tab.active'

export const TAB_ACTIVE_BOUNDARY_AUDIT_EVENT = 'FILE-TAB-ACTIVE-BOUNDARY-GEOMETRY-AUDIT'

/** A commit whose cut is within this many px of the previous one is a no-op. */
export const TAB_ACTIVE_BOUNDARY_COMMIT_EPSILON_PX = 0.5

/** Sampling threshold for the low-frequency SCROLL audit (see §49). */
export const TAB_ACTIVE_BOUNDARY_SCROLL_AUDIT_STEP_PX = 8

export interface TabActiveBoundaryCut {
  cutLeft: number
  cutWidth: number
}

export interface TabActiveBoundaryRect {
  left: number
  right: number
}

/**
 * Visible-intersection math (§11). The cut-out must never extend past the
 * wrapper's visible range, and a fully offscreen Active tab yields width 0 —
 * i.e. no gap is manufactured in the wrong place.
 */
export function computeActiveTabVisibleCut(
  activeRect: TabActiveBoundaryRect,
  wrapperRect: TabActiveBoundaryRect,
): TabActiveBoundaryCut {
  const rangeWidth = wrapperRect.right - wrapperRect.left
  if (!(rangeWidth > 0)) return { cutLeft: 0, cutWidth: 0 }
  const visibleLeft = Math.max(activeRect.left, wrapperRect.left)
  const visibleRight = Math.min(activeRect.right, wrapperRect.right)
  const visibleWidth = Math.max(0, visibleRight - visibleLeft)
  if (!(visibleWidth > 0)) return { cutLeft: 0, cutWidth: 0 }
  const cutLeft = Math.max(0, Math.min(rangeWidth, visibleLeft - wrapperRect.left))
  const cutWidth = Math.max(0, Math.min(visibleWidth, rangeWidth - cutLeft))
  return { cutLeft, cutWidth }
}

function formatPx(value: number): string {
  return `${Math.round(value * 100) / 100}px`
}

function round2(value: number): number {
  return Math.round(value * 100) / 100
}

export interface TabActiveBoundaryGeometryControllerOptions {
  doc: Document
  /** Low-frequency audit sink (§49). Never called per scroll event. */
  audit?: (payload: Record<string, unknown>) => void
  /**
   * Test seam only: when omitted the controller uses the real
   * `requestAnimationFrame` / `cancelAnimationFrame` (with a one-shot
   * `setTimeout` fallback for environments without rAF). It is never a poller.
   */
  frameClock?: TabActiveBoundaryFrameClock
}

export interface TabActiveBoundaryFrameClock {
  request(cb: () => void): number
  cancel(handle: number): void
}

/** Read-only observability for the runtime gates. */
export interface TabActiveBoundaryGeometryDiagnostics {
  bound: boolean
  boundScrollListenerCount: number
  resizeObserverCount: number
  resizeObservedElementCount: number
  rafPending: boolean
  commitCount: number
  maxCommitsInFrame: number
  lastCutLeft: number
  lastCutWidth: number
}

export class TabActiveBoundaryGeometryController {
  private readonly doc: Document
  private readonly auditFn?: (payload: Record<string, unknown>) => void
  private readonly frameClock?: TabActiveBoundaryFrameClock

  private bound = false
  private rafHandle: number | null = null
  private pendingReason: string | null = null
  private commitsThisFrame = 0

  private scrollEls: HTMLElement[] = []
  private resizeObservedEls: HTMLElement[] = []
  private resizeObserver: ResizeObserver | null = null

  private committedEl: HTMLElement | null = null
  private hasCommitted = false
  private lastCutLeft = 0
  private lastCutWidth = 0

  private commitCount = 0
  private maxCommitsInFrame = 0
  private lastAuditedScrollCutLeft: number | null = null

  constructor(options: TabActiveBoundaryGeometryControllerOptions) {
    this.doc = options.doc
    this.auditFn = options.audit
    this.frameClock = options.frameClock
  }

  /**
   * Idempotent: a second call can never install a duplicate listener/observer
   * (the element lists are the guard), while still picking up wrappers that were
   * (re-)created by the workspace.
   *
   * The bind-time measurement is SYNCHRONOUS on purpose — there is no frame to
   * wait for on mount / Active switch, and it keeps the ONE-commit-per-frame
   * guarantee intact: if a frame is already queued, bind only updates its reason
   * instead of committing a second time.
   */
  bind(reason = 'BIND'): void {
    let added = 0
    for (const wrapper of this.collectWrappers()) {
      if (!this.scrollEls.includes(wrapper)) {
        wrapper.addEventListener('scroll', this.onScroll, { passive: true })
        this.scrollEls.push(wrapper)
        added++
      }
      this.observeResize(wrapper)
    }
    this.bound = true
    if (this.rafHandle !== null) this.pendingReason = reason
    else this.syncGeometry(reason)
    if (added > 0) {
      this.audit({
        action: 'BIND',
        reason,
        wrapperCount: this.scrollEls.length,
        addedScrollListeners: added,
        ...this.measureGeometry(this.resolveOwner()),
      })
    }
  }

  /** Releases every listener / observer / rAF and resets the custom properties. */
  unbind(): void {
    for (const el of this.scrollEls) el.removeEventListener('scroll', this.onScroll)
    this.scrollEls = []
    this.resizeObserver?.disconnect()
    this.resizeObserver = null
    this.resizeObservedEls = []
    if (this.rafHandle !== null) {
      this.cancelFrame(this.rafHandle)
      this.rafHandle = null
    }
    this.pendingReason = null
    this.clearCommitted()
    this.lastAuditedScrollCutLeft = null
    this.bound = false
    this.audit({ action: 'UNBIND' })
  }

  /** rAF-coalesced: at most ONE geometry commit per frame (§20). */
  scheduleSync(reason: string): void {
    if (!this.bound) return
    this.pendingReason = reason
    if (this.rafHandle !== null) return
    this.rafHandle = this.requestFrame(() => {
      this.rafHandle = null
      this.commitsThisFrame = 0
      const pending = this.pendingReason ?? reason
      this.pendingReason = null
      this.syncGeometry(pending)
      if (this.commitsThisFrame > this.maxCommitsInFrame) {
        this.maxCommitsInFrame = this.commitsThisFrame
      }
    })
  }

  /** Measures the Active tab ∩ wrapper visible range and commits it. */
  syncGeometry(reason: string): void {
    if (!this.bound) return
    const owner = this.resolveOwner()
    if (!owner) {
      this.clearCommitted()
      return
    }
    const wrapperRect = owner.wrapper.getBoundingClientRect()
    const activeRect = owner.active.getBoundingClientRect()
    const cut = computeActiveTabVisibleCut(activeRect, wrapperRect)
    this.commit(owner.wrapper, cut, reason, owner)
  }

  getDiagnostics(): TabActiveBoundaryGeometryDiagnostics {
    return {
      bound: this.bound,
      boundScrollListenerCount: this.scrollEls.length,
      resizeObserverCount: this.resizeObserver ? 1 : 0,
      resizeObservedElementCount: this.resizeObservedEls.length,
      rafPending: this.rafHandle !== null,
      commitCount: this.commitCount,
      maxCommitsInFrame: this.maxCommitsInFrame,
      lastCutLeft: this.lastCutLeft,
      lastCutWidth: this.lastCutWidth,
    }
  }

  // ── internals ─────────────────────────────────────────────────────────────

  private readonly onScroll = (): void => {
    this.scheduleSync('SCROLL')
  }

  private collectWrappers(): HTMLElement[] {
    return Array.from(this.doc.querySelectorAll<HTMLElement>(TAB_ACTIVE_BOUNDARY_WRAPPER_SELECTOR))
  }

  /**
   * Read-only vertical-order evidence for the runtime gates. It never writes.
   * NOTE the REAL geometry: `.typ-workspace-tab-header` and `.typ-tabs-wrapper`
   * are the SAME node, so `wrapperRectBottom === headerRectBottom` by identity;
   * the meaningful comparison is therefore against the NATIVE SCROLLBAR bottom,
   * which is `wrapperRect.bottom - borderBottomWidth` (a scrollbar is laid out
   * between the padding edge and the border edge). The painted boundary is the
   * last pixel of that border box.
   */
  private measureGeometry(owner: { wrapper: HTMLElement; active: HTMLElement } | null): Record<string, unknown> {
    if (!owner) return { geometryOwnerPresent: false }
    const wrapper = owner.wrapper
    const rect = wrapper.getBoundingClientRect()
    const computed = typeof getComputedStyle === 'function' ? getComputedStyle(wrapper) : null
    const borderBottomPx = computed ? parseFloat(computed.borderBottomWidth) || 0 : 0
    const borderTopPx = computed ? parseFloat(computed.borderTopWidth) || 0 : 0
    const scrollbarThicknessPx = Math.round(wrapper.offsetHeight - wrapper.clientHeight - borderTopPx - borderBottomPx)
    const wrapperBorderBoxBottom = rect.bottom
    const scrollbarBottomY = wrapperBorderBoxBottom - borderBottomPx
    const bottomBoundaryY = wrapperBorderBoxBottom - 1
    return {
      geometryOwnerPresent: true,
      headerIsWrapperSameNode: wrapper.classList.contains('typ-workspace-tab-header'),
      // `wrapperRectBottom` = the shell's bottom INCLUDING the native scrollbar,
      // i.e. the inner border edge — the meaningful reference the gate means by
      // "wrapper bottom". `wrapperBorderBoxBottom` is the raw rect bottom, which
      // necessarily CONTAINS the boundary because the two selectors are one node.
      wrapperRectBottom: round2(scrollbarBottomY),
      wrapperBorderBoxBottom: round2(wrapperBorderBoxBottom),
      headerRectBottom: round2(wrapperBorderBoxBottom),
      wrapperRectLeft: round2(rect.left),
      wrapperRectRight: round2(rect.right),
      wrapperRectWidth: round2(rect.width),
      wrapperBorderBoxHeight: round2(rect.height),
      borderBottomPx: round2(borderBottomPx),
      nativeScrollbarThicknessPx: scrollbarThicknessPx,
      scrollbarBottomY: round2(scrollbarBottomY),
      bottomBoundaryY: round2(bottomBoundaryY),
      wrapperToBoundaryGapPx: round2(bottomBoundaryY - scrollbarBottomY),
      boundaryBelowWrapperRectBottom: bottomBoundaryY >= scrollbarBottomY,
      scrollbarAboveBoundary: bottomBoundaryY > scrollbarBottomY,
    }
  }

  private resolveOwner(): { wrapper: HTMLElement; active: HTMLElement } | null {
    const active = this.doc.querySelector<HTMLElement>(
      `${TAB_ACTIVE_BOUNDARY_WRAPPER_SELECTOR} ${TAB_ACTIVE_BOUNDARY_ACTIVE_SELECTOR}`,
    )
    if (!active) return null
    const wrapper = active.closest<HTMLElement>(TAB_ACTIVE_BOUNDARY_WRAPPER_SELECTOR)
    if (!wrapper) return null
    return { wrapper, active }
  }

  private observeResize(el: HTMLElement): void {
    if (typeof ResizeObserver === 'undefined') return
    if (!this.resizeObserver) {
      this.resizeObserver = new ResizeObserver(() => this.scheduleSync('RESIZE'))
    }
    if (this.resizeObservedEls.includes(el)) return
    this.resizeObserver.observe(el)
    this.resizeObservedEls.push(el)
  }

  private commit(
    wrapper: HTMLElement,
    cut: TabActiveBoundaryCut,
    reason: string,
    owner: { wrapper: HTMLElement; active: HTMLElement },
  ): void {
    // Ownership migration: never leave a stale cut-out on a previous wrapper.
    if (this.committedEl && this.committedEl !== wrapper) {
      this.clearCommitted()
    }
    const unchanged =
      this.hasCommitted &&
      this.committedEl === wrapper &&
      Math.abs(cut.cutLeft - this.lastCutLeft) < TAB_ACTIVE_BOUNDARY_COMMIT_EPSILON_PX &&
      Math.abs(cut.cutWidth - this.lastCutWidth) < TAB_ACTIVE_BOUNDARY_COMMIT_EPSILON_PX
    if (unchanged) return

    wrapper.style.setProperty(TAB_ACTIVE_BOUNDARY_CUT_LEFT_VAR, formatPx(cut.cutLeft))
    wrapper.style.setProperty(TAB_ACTIVE_BOUNDARY_CUT_WIDTH_VAR, formatPx(cut.cutWidth))
    this.committedEl = wrapper
    this.hasCommitted = true
    this.lastCutLeft = cut.cutLeft
    this.lastCutWidth = cut.cutWidth
    this.commitCount++
    this.commitsThisFrame++
    this.auditCommit(reason, cut, owner)
  }

  private clearCommitted(): void {
    if (this.committedEl) {
      this.committedEl.style.removeProperty(TAB_ACTIVE_BOUNDARY_CUT_LEFT_VAR)
      this.committedEl.style.removeProperty(TAB_ACTIVE_BOUNDARY_CUT_WIDTH_VAR)
    }
    this.committedEl = null
    this.hasCommitted = false
    this.lastCutLeft = 0
    this.lastCutWidth = 0
  }

  /** §49 — low frequency only: never one entry per scroll event. */
  private auditCommit(
    reason: string,
    cut: TabActiveBoundaryCut,
    owner: { wrapper: HTMLElement; active: HTMLElement },
  ): void {
    if (!this.auditFn) return
    if (reason === 'SCROLL') {
      const last = this.lastAuditedScrollCutLeft
      if (last !== null && Math.abs(cut.cutLeft - last) < TAB_ACTIVE_BOUNDARY_SCROLL_AUDIT_STEP_PX) return
      this.lastAuditedScrollCutLeft = cut.cutLeft
      this.audit({
        action: 'GEOMETRY_COMMIT',
        reason,
        cutLeft: round2(cut.cutLeft),
        cutWidth: round2(cut.cutWidth),
      })
      return
    }
    // Non-scroll reasons are inherently low frequency (mount / Active switch /
    // open / close / resize): carry the vertical-order evidence with them.
    this.audit({
      action: 'GEOMETRY_COMMIT',
      reason,
      cutLeft: round2(cut.cutLeft),
      cutWidth: round2(cut.cutWidth),
      ...this.measureGeometry(owner),
    })
  }

  private audit(payload: Record<string, unknown>): void {
    this.auditFn?.(payload)
  }

  private requestFrame(cb: () => void): number {
    if (this.frameClock) return this.frameClock.request(cb)
    if (typeof requestAnimationFrame === 'function') return requestAnimationFrame(cb)
    // jsdom / environments without rAF — a one-shot deferral, never a poller.
    return setTimeout(cb, 0) as unknown as number
  }

  private cancelFrame(handle: number): void {
    if (this.frameClock) {
      this.frameClock.cancel(handle)
      return
    }
    if (typeof cancelAnimationFrame === 'function') {
      cancelAnimationFrame(handle)
      return
    }
    clearTimeout(handle as unknown as ReturnType<typeof setTimeout>)
  }
}
