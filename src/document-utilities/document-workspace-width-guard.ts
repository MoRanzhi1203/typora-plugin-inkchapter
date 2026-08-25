/**
 * Phase 7R.3.11.8B.6 — Document Workspace Minimum Width Guard.
 *
 * PROBLEM: when the Typora window narrows while the native sidebar stays open,
 * the Document Workspace flex item keeps shrinking (its CSS min-width defaults
 * to auto/0), collapsing the editor to a few characters per line.
 *
 * FIX (single authority): a declarative `min-width` on the REAL workspace flex
 * item (resolved at runtime — never a hardcoded `#write` width, never a broad
 * `div { min-width }`). The workspace keeps its theme max-width/paper layout;
 * only the VIEWPORT minimum is protected. When the window cannot fit
 * sidebar + workspace-min, the workspace stays at the minimum and the outer
 * shell clips/overflows horizontally (controlled) instead of collapsing the
 * text. The native sidebar is NEVER auto-collapsed.
 *
 * State model (write-deduped, audited):
 *   NORMAL         workspace >= normalThreshold
 *   COMPACT        minWidth <= workspace < normalThreshold
 *   MIN_WIDTH_GUARD requested < minWidth  → effective stays >= minWidth
 */
import { getActiveEditorScrollContainer } from './document-scroll-navigator'

// ── Unified Width Authority (single token; no scattered magic numbers) ──
export const DOCUMENT_WORKSPACE_MIN_WIDTH_PX = 520
/** Threshold above which the layout is fully NORMAL (initial; runtime-validated). */
export const DOCUMENT_WORKSPACE_NORMAL_THRESHOLD_PX = 700
/** State token on the InkChapter overlay root (declarative; never inline width). */
export const WORKSPACE_WIDTH_STATE_ATTR = 'data-inkchapter-workspace-width-state'
/** Scoped class added to the resolved workspace flex item (the ONLY min-width hook). */
export const WORKSPACE_HOST_CLASS = 'inkchapter-workspace-host'
/** CSS custom property consumed by the declarative min-width rule. */
export const WORKSPACE_MIN_WIDTH_CSS_VAR = '--inkchapter-document-workspace-min-width'

export type WorkspaceWidthState = 'normal' | 'compact' | 'min-width-guard'

export const WORKSPACE_WIDTH_STATES: readonly WorkspaceWidthState[] = ['normal', 'compact', 'min-width-guard']

/**
 * Pure state resolution from the REQUESTED workspace width (the natural flex
 * width before the guard). Never reads the DOM — fully unit-testable.
 */
export function resolveWorkspaceWidthState(
  requestedWidth: number,
  minWidth = DOCUMENT_WORKSPACE_MIN_WIDTH_PX,
  normalThreshold = DOCUMENT_WORKSPACE_NORMAL_THRESHOLD_PX,
): WorkspaceWidthState {
  if (!Number.isFinite(requestedWidth) || requestedWidth < minWidth) return 'min-width-guard'
  if (requestedWidth < normalThreshold) return 'compact'
  return 'normal'
}

export interface WorkspaceWidthSample {
  windowInnerWidth: number
  sidebarVisible: boolean
  sidebarWidth: number
  workspaceRequestedWidth: number
  workspaceClientWidth: number
  workspaceScrollWidth: number
  editorViewportWidth: number
  drawerVisible: boolean
  drawerWidth: number
  navigatorVisible: boolean
  navigatorWidth: number
  widthState: WorkspaceWidthState
}

/**
 * Resolve the REAL workspace flex item. Two evidence-based strategies:
 *
 *  1. Sidebar-sibling walk: from the editor scroll container up to the element
 *     whose parent ALSO directly contains the native sidebar (nested workspace
 *     layouts where the workspace is a wrapper around the scroll container).
 *  2. Runtime-proven fallback (Typora real DOM, captured 7R.3.11.8B.6): the
 *     editor scroll container (#write.parentElement — `content.typ-workspace-
 *     binding`) IS the workspace flex item itself: `flex: 0 1 auto`,
 *     `flex-shrink: 1`, `min-width: 0px` → it is the FIRST_FAILING_LAYER that
 *     lets the workspace collapse. Return it when it is a shrinkable flex item
 *     with real layout width.
 *
 * Returns null when neither resolves (STOP + log; never guess an ancestor).
 */
export function resolveWorkspaceHost(root?: HTMLElement | null): HTMLElement | null {
  let scroll: HTMLElement | null
  if (root && root.isConnected) {
    scroll = root
  } else {
    scroll = getActiveEditorScrollContainer()
  }
  if (!scroll || !scroll.isConnected) return null
  let el: HTMLElement | null = scroll
  const seen = new Set<HTMLElement>()
  while (el && el !== document.body && !seen.has(el)) {
    seen.add(el)
    const parent: HTMLElement | null = el.parentElement
    if (!parent) break
    const sidebar = parent.querySelector(':scope > #typora-sidebar, :scope > .typora-sidebar')
    if (sidebar) return el
    el = parent
  }
  // Strategy 2 — the scroll container itself is the workspace flex item.
  const scrollCs = getComputedStyle(scroll)
  const shrink = Number.parseFloat(scrollCs.flexShrink)
  if (Number.isFinite(shrink) && shrink >= 1 && scroll.clientWidth > 0) return scroll
  return null
}

/** Sidebar width (0 when hidden/closed). */
export function readSidebarWidth(): { visible: boolean; width: number } {
  const sidebar = document.querySelector<HTMLElement>('#typora-sidebar, .typora-sidebar')
  if (!sidebar) return { visible: false, width: 0 }
  if (sidebar.offsetParent === null) return { visible: false, width: 0 }
  return { visible: true, width: sidebar.getBoundingClientRect().width }
}

/**
 * Read-only width sampling for the invariant audit. Pure geometry reads.
 *
 * `workspaceRequestedWidth` = window width minus sidebar (the space the shell
 * WOULD allocate to the workspace before the guard). `workspaceClientWidth` =
 * the workspace's EFFECTIVE border-box layout width via getBoundingClientRect()
 * — this includes the scrollbar gutter, so an element clamped by `min-width`
 * reports the full minimum (520), never 520 − scrollbar.
 */
export function sampleWorkspaceWidths(root?: HTMLElement | null): WorkspaceWidthSample {
  const host = root && root.isConnected ? root : resolveWorkspaceHost()
  const scroll = getActiveEditorScrollContainer()
  const sidebar = readSidebarWidth()
  const windowInnerWidth = window.innerWidth
  const workspaceRequested = Math.max(0, windowInnerWidth - sidebar.width)
  const hostRectWidth = host ? Math.round(host.getBoundingClientRect().width) : 0
  const state = resolveWorkspaceWidthState(workspaceRequested)
  return {
    windowInnerWidth,
    sidebarVisible: sidebar.visible,
    sidebarWidth: sidebar.width,
    workspaceRequestedWidth: workspaceRequested,
    workspaceClientWidth: hostRectWidth,
    workspaceScrollWidth: host ? host.scrollWidth : 0,
    editorViewportWidth: scroll ? Math.round(scroll.getBoundingClientRect().width) : 0,
    drawerVisible: false,
    drawerWidth: 0,
    navigatorVisible: false,
    navigatorWidth: 0,
    widthState: state,
  }
}

/**
 * Effective workspace width after the guard: the workspace is allowed to be
 * exactly at the minimum even when the window cannot fit sidebar + min
 * (the outer shell clips/overflows horizontally instead).
 */
export function computeGuardedWorkspaceWidth(
  requestedWidth: number,
  minWidth = DOCUMENT_WORKSPACE_MIN_WIDTH_PX,
): number {
  return Math.max(requestedWidth, minWidth)
}
