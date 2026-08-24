/**
 * Phase 7R.3.11 — Document Scroll Navigator (↑ / ↓).
 *
 * Event-driven only: one scroll listener on the resolved editor scroll
 * container with rAF coalescing. Never polls scrollTop. Both buttons share
 * getActiveEditorScrollContainer() so no duplicate DOM queries.
 */
import { prefersReducedMotion } from './document-diagnostic-locator'
import { resolveEditorScrollContainer } from './document-utilities-context'

const SCROLL_TOLERANCE_PX = 2

export interface ScrollNavigatorState {
  atTop: boolean
  atBottom: boolean
  scrollable: boolean
}

export interface ScrollNavigatorHandlers {
  getContainer: () => HTMLElement | null
  onStateChange: (state: ScrollNavigatorState) => void
}

export function getActiveEditorScrollContainer(): HTMLElement | null {
  return resolveEditorScrollContainer()
}

export function computeScrollNavigatorState(
  container: HTMLElement | null,
): ScrollNavigatorState {
  if (!container) return { atTop: true, atBottom: true, scrollable: false }
  const max = container.scrollHeight - container.clientHeight
  const scrollable = max > SCROLL_TOLERANCE_PX
  if (!scrollable) return { atTop: true, atBottom: true, scrollable: false }
  return {
    atTop: container.scrollTop <= SCROLL_TOLERANCE_PX,
    atBottom: container.scrollTop >= max - SCROLL_TOLERANCE_PX,
    scrollable: true,
  }
}

export class DocumentScrollNavigator {
  private container: HTMLElement | null = null
  private listenerBound = false
  private rafPending = false
  private disposed = false

  constructor(private handlers: ScrollNavigatorHandlers) {}

  /** Bind to the current active editor scroll container (once). */
  bind(): void {
    this.unbind()
    const container = this.handlers.getContainer()
    this.container = container
    if (!container) {
      this.handlers.onStateChange({ atTop: true, atBottom: true, scrollable: false })
      return
    }
    container.addEventListener('scroll', this.onScroll, { passive: true })
    this.listenerBound = true
    this.emitState()
  }

  /** Unbind the current scroll listener (document switch / dispose). */
  unbind(): void {
    if (this.listenerBound && this.container) {
      this.container.removeEventListener('scroll', this.onScroll)
    }
    this.listenerBound = false
    this.container = null
    this.rafPending = false
  }

  private onScroll = (): void => {
    if (this.rafPending || this.disposed) return
    this.rafPending = true
    requestAnimationFrame(() => {
      this.rafPending = false
      if (this.disposed) return
      this.emitState()
    })
  }

  private emitState(): void {
    this.handlers.onStateChange(computeScrollNavigatorState(this.container))
  }

  /** Scroll to document top. */
  scrollToTop(): void {
    const container = this.container
    if (!container) return
    const behavior: ScrollBehavior = prefersReducedMotion() ? 'auto' : 'smooth'
    container.scrollTo({ top: 0, behavior })
  }

  /** Scroll to the real document bottom (scrollHeight - clientHeight). */
  scrollToBottom(): void {
    const container = this.container
    if (!container) return
    const max = container.scrollHeight - container.clientHeight
    const behavior: ScrollBehavior = prefersReducedMotion() ? 'auto' : 'smooth'
    container.scrollTo({ top: max, behavior })
  }

  dispose(): void {
    this.disposed = true
    this.unbind()
  }
}
