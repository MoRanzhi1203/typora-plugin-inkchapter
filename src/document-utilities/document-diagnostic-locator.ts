/**
 * Phase 7R.3.11 — Document Diagnostic Locator.
 *
 * Non-mutating: scrolls the current canonical target into view and applies a
 * temporary scoped highlight. NEVER synthetically clicks, changes heading
 * level, focuses an editable field, or edits Markdown. When the target is gone
 * it reports stale instead of scrolling to a random node.
 */
import { resolveEditorScrollContainer } from './document-utilities-context'

export const DIAGNOSTIC_HIGHLIGHT_CLASS = 'inkchapter-diagnostic-highlight'
export const DIAGNOSTIC_HIGHLIGHT_MS = 1600

export interface DiagnosticLocateResult {
  located: boolean
  reason?: 'NO_TARGET' | 'NOT_CONNECTED' | 'SCROLLED'
}

export function prefersReducedMotion(): boolean {
  try {
    return window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false
  } catch {
    return false
  }
}

function scrollTargetIntoView(target: HTMLElement, container: HTMLElement | null): void {
  const behavior: ScrollBehavior = prefersReducedMotion() ? 'auto' : 'smooth'
  try {
    target.scrollIntoView({ behavior, block: 'center' })
  } catch {
    target.scrollIntoView()
  }
  if (container && !prefersReducedMotion()) {
    // Fallback for engines without smooth scrollIntoView support.
    const rect = target.getBoundingClientRect()
    if (rect.height === 0) {
      const cr = container.getBoundingClientRect()
      container.scrollTop += rect.top - cr.top - cr.height / 2
    }
  }
}

/**
 * Locate a diagnostic target: scroll into view + temporary highlight.
 * Returns the number of DOM mutations performed (must be 0 for gate checks —
 * highlight is a class toggle, reported separately via highlightApplied()).
 */
export class DocumentDiagnosticLocator {
  private highlightTimer: ReturnType<typeof setTimeout> | null = null

  constructor(
    private opts: {
      getContainer: () => HTMLElement | null
      onStale?: () => void
    },
  ) {}

  /** Remove any active highlight (idempotent, non-mutating when none). */
  clearHighlight(): void {
    if (this.highlightTimer) {
      clearTimeout(this.highlightTimer)
      this.highlightTimer = null
    }
    document.querySelectorAll(`.${DIAGNOSTIC_HIGHLIGHT_CLASS}`).forEach(el => el.classList.remove(DIAGNOSTIC_HIGHLIGHT_CLASS))
  }

  /**
   * Locate the target element.
   * @returns true when scrolled+highlighted, false when stale (no mutation).
   */
  locate(target: HTMLElement | null): DiagnosticLocateResult {
    this.clearHighlight()
    if (!target) {
      this.opts.onStale?.()
      return { located: false, reason: 'NO_TARGET' }
    }
    if (!target.isConnected) {
      this.opts.onStale?.()
      return { located: false, reason: 'NOT_CONNECTED' }
    }
    const container = this.opts.getContainer()
    scrollTargetIntoView(target, container)
    target.classList.add(DIAGNOSTIC_HIGHLIGHT_CLASS)
    this.highlightTimer = setTimeout(() => {
      target.classList.remove(DIAGNOSTIC_HIGHLIGHT_CLASS)
      this.highlightTimer = null
    }, DIAGNOSTIC_HIGHLIGHT_MS)
    return { located: true, reason: 'SCROLLED' }
  }

  /** Resolve the editor scroll container (shared with the scroll navigator). */
  static resolveContainer(): HTMLElement | null {
    return resolveEditorScrollContainer()
  }
}
