/**
 * Phase 7R.3.11 — Document Utility Overlay Host (singleton).
 *
 * Mounts the DocumentStatusToolbar (top-right) + DocumentScrollNavigator
 * (lower-right) + DocumentDiagnosticsDrawer as editor-shell overlays OUTSIDE
 * the Markdown business content (#write). The whole tree is marked
 * `data-inkchapter-ui-root="document-utilities"` so every mutation observer /
 * classifier can recognize it as INKCHAPTER_UI_INTERNAL.
 *
 * Placement is anchored to the real editor shell (`#write` parent = scroll
 * container) via position:fixed + rect sync — never to the whole window.
 */
import { DocumentDiagnosticsAuthority } from './document-diagnostics-authority'
import type { DocumentDiagnosticsProviders } from './document-diagnostics-authority'
import { DocumentDiagnosticLocator, prefersReducedMotion } from './document-diagnostic-locator'
import type { DiagnosticLocateResult } from './document-diagnostic-locator'
import {
  resolveDiagnosticLocation,
  getRuleMeta,
  type DiagnosticLocationResolveContext,
} from './document-diagnostic-location'
import { DocumentEditGuard } from './document-edit-guard'
import { DocumentScrollNavigator, getActiveEditorScrollContainer } from './document-scroll-navigator'
import type { ScrollNavigatorState } from './document-scroll-navigator'
import { deriveDiagnosticsState } from './document-diagnostics'
import type { DocumentDiagnosticsSnapshot } from './diagnostics-types'
import { resolveBusinessContentRoot, type DocumentUtilitiesContext } from './document-utilities-context'
import { emitRuntimeAudit, emitInkchapterRuntimeAuditSummary } from '../runtime/forensic-log-sink'

export const UTILITY_UI_ROOT_ATTR = 'data-inkchapter-ui-root'
export const UTILITY_UI_ROOT_VALUE = 'document-utilities'
/** Root-identity attribute (the whole tree shares UTILITY_UI_ROOT_ATTR). */
export const UTILITY_ROOT_IDENTITY_ATTR = 'data-inkchapter-utility-root'

export interface DocumentUtilitiesOverlayOptions {
  ctx: DocumentUtilitiesContext
  providers: DocumentDiagnosticsProviders
  /** Recompute triggers wired by the caller (document switch etc.). */
  onBindDocument?: (bind: () => void) => void
  /** Phase 7R.3.11.8-B — light diagnostics recompute triggers (frame commit /
   *  settings/mode change). Called with a recompute() that ONLY refreshes the
   *  diagnostics snapshot — no geometry / BCR / scroll rebind churn. */
  onDiagnosticsTrigger?: (recompute: () => void) => void
}

const TOOLBAR_TOP_PX = 12
const TOOLBAR_RIGHT_PX = 24
const NAV_RIGHT_PX = 28
const NAV_BOTTOM_PX = 64
const DRAWER_TOP_PX = 56
const DRAWER_RIGHT_PX = 12
const DRAWER_BOTTOM_PX = 16
/**
 * Phase 7R.3.11.8B.3 — vertical space reserved below the drawer for the
 * right-bottom navigator zone (navigator height ~66px + safety gap). The
 * drawer may only grow down to `viewport - drawerTop - this` before its body
 * scrolls internally. The navigator NEVER moves to resolve conflicts.
 */
const DRAWER_BOTTOM_RESERVED_PX = 140
/** Phase 7R.3.11.8B.3 — scrollability epsilon (px). maxScrollTop <= this ⇒ short document. */
const SCROLLABLE_EPSILON_PX = 1

export interface OverlayGeometry {
  toolbarTop: number
  toolbarRight: number
  navRight: number
  navBottom: number
  drawerTop: number
  drawerRight: number
  drawerBottom: number
  /** Phase 7R.3.11.8B.3 — scrollability from the REAL scroll container. */
  scrollable: boolean
  navigatorVisible: boolean
  /** Phase 7R.3.11.8B.3 — drawer may not exceed this (viewport − top − reserved). */
  drawerMaxHeight: number
}

export interface OverlayGeometryOptions {
  drawerOpen: boolean
  /** Phase 7R.3.11.8B.3 — live scroll container metrics (scrollability authority). */
  scrollHeight?: number
  clientHeight?: number
}

const DRAWER_WIDTH_PX = 360
/** Legacy Drawer↔navigator horizontal gap constant (kept; not used for
 *  positioning since 7R.3.11.8B.3 — the navigator is an independent anchor). */
const DRAWER_NAV_GAP_PX = 16

/** Phase 7R.3.11.4 — ResizeObserver attribution windows (single source of truth). */
const EXTERNAL_RESIZE_WINDOW_MS = 100
const UTILITY_WRITE_WINDOW_MS = 100

/** Phase 7R.3.11.6 — navigator placement tolerance (px) for NAV-PLACEMENT gate. */
const NAV_PLACEMENT_TOLERANCE_PX = 3

/** Phase 7R.3.11.8-B — scroll operation authority constants. */
export const SCROLL_OP_EPSILON_PX = 1
/** Quiescence window: the operation finalizes when no scroll event arrives for
 *  this window (NOT a fixed click-to-success delay). */
export const SCROLL_OP_QUIESCENCE_MS = 150
/** Bounded safety deadline — resource leak guard / TIMEOUT classification ONLY. */
export const SCROLL_OP_SAFETY_DEADLINE_MS = 2000
/** Bounded corrective recovery: at most ONE auto scroll after a genuine early stop. */
export const SCROLL_OP_MAX_RECOVERY_ATTEMPTS = 1

export type ScrollOperationSource = 'BUTTON' | 'DIAGNOSTIC_LOCATE'

export type ScrollOperationDecision =
  | 'PASS'
  | 'PASS_RECOVERED'
  | 'PASS_TARGET_REACHED_AT_DEADLINE'
  | 'FAIL_SETTLED_BEFORE_TARGET'
  | 'FAIL_CONTAINER_DISCONNECTED'
  | 'CANCELLED_DOCUMENT_SWITCH'
  | 'SUPERSEDED'
  | 'TIMEOUT_BEFORE_SETTLE'

export type ScrollOperationSettleReason = 'SCROLLEND' | 'QUIESCENCE' | 'SAFETY_TIMEOUT'

export type ResizeAttributionVerdict =
  | 'ATTRIBUTED_TO_DOCUMENT_UTILITIES'
  | 'ATTRIBUTED_TO_EXTERNAL_RESIZE'
  | 'MIXED'
  | 'UNPROVEN'

/** Phase 7R.3.11.5 — audit consistency (callback count vs RO epoch). */
export function computeAuditConsistency(
  resizeObserverCallbackCount: number,
  resizeObserverEpoch: number,
): { resizeObserverCallbackCount: number; resizeObserverEpoch: number; difference: number; decision: 'PASS' | 'FAIL' } {
  const difference = resizeObserverCallbackCount - resizeObserverEpoch
  return { resizeObserverCallbackCount, resizeObserverEpoch, difference, decision: difference === 0 ? 'PASS' : 'FAIL' }
}

export interface ScrollNavAuditPayload {
  documentKey: string | null
  source: 'BUTTON'
  action: 'GO_TOP' | 'GO_BOTTOM'
  scrollTopBefore: number
  scrollTopAfter: number
  maxScrollTop: number
  atTopBefore: boolean
  atBottomBefore: boolean
  atTopAfter: boolean
  atBottomAfter: boolean
  drawerVisible: boolean
  locked: boolean
  decision: 'PASS' | 'FAIL'
}

/**
 * Phase 7R.3.11.8-B — ONE finite event-driven scroll operation per button click.
 * The fixed-250ms read is NOT an authority; settle is decided by scrollend /
 * quiescence + final live target, with at most ONE corrective recovery.
 */
export interface ActiveScrollOperation {
  operationId: number
  documentKey: string | null
  action: 'GO_TOP' | 'GO_BOTTOM'
  source: ScrollOperationSource
  container: HTMLElement
  startTs: number
  scrollTopStart: number
  maxScrollTopStart: number
  targetAtStart: number
  scrollEventCount: number
  firstScrollEventTs: number | null
  lastScrollEventTs: number | null
  scrollTopLastObserved: number
  maxScrollTopLastObserved: number
  reversalCount: number
  scrollTopAtLegacyCheck: number | null
  legacyWouldPass: boolean | null
  recoveryAttemptCount: number
  drawerVisibleAtStart: boolean
  lockedAtStart: boolean
  settleTimer: ReturnType<typeof setTimeout> | null
  safetyDeadline: ReturnType<typeof setTimeout> | null
  legacySampleTimer: ReturnType<typeof setTimeout> | null
  onScroll: () => void
  onScrollEnd: (() => void) | null
}

/** Phase 7R.3.11.5 — scroll navigator BUTTON action audit payload (pure). */
export function buildScrollNavAudit(opts: {
  documentKey: string | null
  action: 'GO_TOP' | 'GO_BOTTOM'
  scrollTopBefore: number
  scrollTopAfter: number
  maxScrollTop: number
  drawerVisible: boolean
  locked: boolean
}): ScrollNavAuditPayload {
  const { action, scrollTopBefore, scrollTopAfter, maxScrollTop } = opts
  const atTopBefore = scrollTopBefore <= 2
  const atBottomBefore = maxScrollTop > 2 && scrollTopBefore >= maxScrollTop - 2
  const atTopAfter = scrollTopAfter <= 2
  const atBottomAfter = maxScrollTop > 2 && scrollTopAfter >= maxScrollTop - 2
  const okTarget = action === 'GO_TOP' ? atTopAfter : maxScrollTop <= 2 || atBottomAfter
  return {
    documentKey: opts.documentKey,
    source: 'BUTTON',
    action,
    scrollTopBefore,
    scrollTopAfter,
    maxScrollTop,
    atTopBefore,
    atBottomBefore,
    atTopAfter,
    atBottomAfter,
    drawerVisible: opts.drawerVisible,
    locked: opts.locked,
    decision: okTarget ? 'PASS' : 'FAIL',
  }
}

/**
 * Phase 7R.3.11.4 — final attribution verdict from causal evidence. MIXED is
 * NEVER upgraded to ATTRIBUTED_TO_DOCUMENT_UTILITIES without confirmed causal
 * proof (feedbackLoopConfirmedCount > 0 AND no external resize epoch change).
 */
export function classifyAttribution(opts: {
  feedbackLoopConfirmedCount: number
  mixedCorrelationCount: number
  externalResizeEpoch: number
  warningCorrelationCount: number
}): ResizeAttributionVerdict {
  if (opts.feedbackLoopConfirmedCount > 0) return 'ATTRIBUTED_TO_DOCUMENT_UTILITIES'
  if (opts.mixedCorrelationCount > 0 && opts.externalResizeEpoch > 0) return 'MIXED'
  if (opts.externalResizeEpoch > 0 && opts.warningCorrelationCount > 0) return 'ATTRIBUTED_TO_EXTERNAL_RESIZE'
  return 'UNPROVEN'
}

/**
 * Phase 7R.3.11.8B.3 — drawer and navigator are INDEPENDENT overlay anchors:
 * the navigator right/bottom never depend on the drawer; the drawer is capped
 * at `viewport − top − reserved` so it can never reach the navigator zone.
 */
export function computeOverlayGeometry(
  shellRect: { top: number; right: number; bottom: number } | null,
  viewport: { width: number; height: number },
  opts?: OverlayGeometryOptions,
): OverlayGeometry {
  const drawerOpen = opts?.drawerOpen ?? false
  const right = shellRect && shellRect.right > 0 ? Math.max(0, viewport.width - shellRect.right) : 0
  const top = shellRect && shellRect.top > 0 ? shellRect.top : 0
  const bottomGap = shellRect && shellRect.bottom > 0 ? Math.max(0, viewport.height - shellRect.bottom) : 0
  // Phase 7R.3.11.8B.3 — the navigator is an INDEPENDENT overlay anchor: its
  // right/bottom depend ONLY on the shell/viewport, never on the drawer.
  const navRight = right + NAV_RIGHT_PX
  // Scrollability from the REAL scroll container (scrollHeight/clientHeight).
  const scrollHeight = opts?.scrollHeight ?? 0
  const clientHeight = opts?.clientHeight ?? 0
  const maxScrollTop = Math.max(0, scrollHeight - clientHeight)
  const scrollable = maxScrollTop > SCROLLABLE_EPSILON_PX
  const drawerTopPx = top + DRAWER_TOP_PX
  // Phase 7R.3.11.8B.3 — drawer may only grow down to the reserved navigator
  // zone; beyond that its body scrolls internally (never push the navigator).
  const drawerMaxHeight = Math.max(0, viewport.height - drawerTopPx - DRAWER_BOTTOM_RESERVED_PX)
  return {
    toolbarTop: top + TOOLBAR_TOP_PX,
    toolbarRight: right + TOOLBAR_RIGHT_PX,
    navRight,
    navBottom: bottomGap + NAV_BOTTOM_PX,
    drawerTop: drawerTopPx,
    drawerRight: right + DRAWER_RIGHT_PX,
    drawerBottom: bottomGap + DRAWER_BOTTOM_PX,
    scrollable,
    navigatorVisible: scrollable,
    drawerMaxHeight,
  }
}

/** Rect intersection area (0 when disjoint). */
export function rectIntersectionArea(
  a: { left: number; top: number; right: number; bottom: number } | null,
  b: { left: number; top: number; right: number; bottom: number } | null,
): number {
  if (!a || !b) return 0
  const left = Math.max(a.left, b.left)
  const top = Math.max(a.top, b.top)
  const right = Math.min(a.right, b.right)
  const bottom = Math.min(a.bottom, b.bottom)
  if (right <= left || bottom <= top) return 0
  return (right - left) * (bottom - top)
}

/** Phase 7R.3.11.4 — visible write rect = intersection(writeRect, scrollViewportRect). */
export function intersectRects(
  a: { left: number; top: number; right: number; bottom: number } | null,
  b: { left: number; top: number; right: number; bottom: number } | null,
): RectRecord | null {
  if (!a || !b) return null
  const left = Math.max(a.left, b.left)
  const top = Math.max(a.top, b.top)
  const right = Math.min(a.right, b.right)
  const bottom = Math.min(a.bottom, b.bottom)
  if (right <= left || bottom <= top) return null
  return { left, top, right, bottom, width: right - left, height: bottom - top }
}

export type BcrVerdict =
  | 'VISIBLE_GEOMETRY'
  | 'GEOMETRY_PENDING'
  | 'GEOMETRY_VALID_NAV_EXPECTED_HIDDEN'
  | 'FAIL_ACCIDENTAL_FULLSCREEN_CHILD'
  | 'NAVIGATOR_STALE_DRAWER_OFFSET'
  | 'NAVIGATOR_NOT_AT_AVOIDANCE_POSITION'
  | 'NAVIGATOR_POSITION_DRIFT'

export type NavigatorPlacementFailure = 'NAVIGATOR_STALE_DRAWER_OFFSET' | 'NAVIGATOR_NOT_AT_AVOIDANCE_POSITION' | 'NAVIGATOR_POSITION_DRIFT'

/**
 * Phase 7R.3.11.8B.3 — navigator placement evaluation (pure, single formula).
 * The navigator is an INDEPENDENT anchor: expectedRight is `right + NAV_RIGHT_PX`
 * regardless of drawer state. Opening/closing the drawer must not move it
 * (deltaX/deltaY <= tolerance). The drawer's vertical growth is capped by
 * drawerMaxHeight instead, so no horizontal conflict can arise.
 *
 * Phase 7R.3.11.8B.3.1 — when `navigatorExpectedVisible=false` the navigator is
 * legally hidden (short document): the placement is NOT_EVALUATED with
 * reason NAVIGATOR_EXPECTED_HIDDEN and no expectedRight/actualRight/rightDelta
 * computation runs (a hidden navigator's BCR is 0×0 and must not drift-FAIL).
 */
export function evaluateNavigatorPlacement(opts: {
  drawerOpen: boolean
  navigatorExpectedVisible: boolean
  navigatorRect: RectRecord | null
  shellRect: RectRecord | null
  viewport: { width: number; height: number }
  tolerancePx: number
}): {
  expectedRight: number
  actualRight: number
  rightDelta: number
  intersectionArea: number
  gapPx: number
  decision: 'PASS' | NavigatorPlacementFailure | 'NOT_EVALUATED'
  reason: string | null
} {
  if (!opts.navigatorExpectedVisible) {
    return {
      expectedRight: -1,
      actualRight: -1,
      rightDelta: -1,
      intersectionArea: 0,
      gapPx: -1,
      decision: 'NOT_EVALUATED',
      reason: 'NAVIGATOR_EXPECTED_HIDDEN',
    }
  }
  const g = computeOverlayGeometry(
    opts.shellRect ? { top: opts.shellRect.top, right: opts.shellRect.right, bottom: opts.shellRect.bottom } : null,
    opts.viewport,
    { drawerOpen: opts.drawerOpen },
  )
  const expectedRight = g.navRight
  const actualRight = opts.navigatorRect ? opts.viewport.width - opts.navigatorRect.right : -1
  const rightDelta = Math.abs(actualRight - expectedRight)
  const drawerLeft = opts.drawerOpen ? opts.viewport.width - (g.drawerRight + DRAWER_WIDTH_PX) : null
  const gapPx = drawerLeft != null && opts.navigatorRect ? Math.max(0, drawerLeft - opts.navigatorRect.right) : -1
  let decision: 'PASS' | NavigatorPlacementFailure | 'NOT_EVALUATED' = 'PASS'
  if (rightDelta > opts.tolerancePx) {
    decision = 'NAVIGATOR_POSITION_DRIFT'
  }
  return { expectedRight, actualRight, rightDelta, intersectionArea: 0, gapPx, decision, reason: decision === 'PASS' ? 'POSITION_STABLE' : 'POSITION_DRIFT' }
}

/**
 * Phase 7R.3.11.4/6 — BCR verdict must never claim VISIBLE before the first
 * geometry commit, before toolbar/navigator are inside the editor shell, and
 * before the navigator is at its drawer-state-specific expected position.
 */
export function computeBcrVerdict(opts: {
  geometryCommitted: boolean
  toolbarInsideEditorShell: boolean
  navigatorInsideEditorShell: boolean
  toolbarVisible: boolean
  navigatorVisible: boolean
  navigatorExpectedVisible: boolean
  toolbarFullscreen: boolean
  navigatorFullscreen: boolean
  drawerFullscreen: boolean
  stateSpecificPlacementValid: boolean
  placementFailure: NavigatorPlacementFailure | null
}): BcrVerdict {
  if (opts.toolbarFullscreen || opts.navigatorFullscreen || opts.drawerFullscreen) return 'FAIL_ACCIDENTAL_FULLSCREEN_CHILD'
  if (!opts.geometryCommitted) return 'GEOMETRY_PENDING'
  if (!opts.toolbarInsideEditorShell) return 'GEOMETRY_PENDING'
  // Phase 7R.3.11.8B.3.1 — a legally EXPECTED-hidden navigator is 0×0, so its
  // "inside editor shell" check is naturally false and must NOT gate the BCR.
  if (opts.navigatorExpectedVisible && !opts.navigatorInsideEditorShell) return 'GEOMETRY_PENDING'
  if (!opts.toolbarVisible) return 'GEOMETRY_PENDING'
  // Phase 7R.3.11.8B.3.1 — a navigator that is legally EXPECTED hidden (short
  // document) must NOT put the whole Document Utilities into GEOMETRY_PENDING:
  // the toolbar alone can still be valid. A 0×0 navigator with
  // expectedVisible=true is the real pending/missing case.
  if (!opts.navigatorVisible && !opts.navigatorExpectedVisible) {
    if (opts.stateSpecificPlacementValid) return 'GEOMETRY_VALID_NAV_EXPECTED_HIDDEN'
    return opts.placementFailure ?? 'GEOMETRY_VALID_NAV_EXPECTED_HIDDEN'
  }
  if (!opts.navigatorVisible) return 'GEOMETRY_PENDING'
  if (!opts.stateSpecificPlacementValid) return opts.placementFailure ?? 'GEOMETRY_PENDING'
  return 'VISIBLE_GEOMETRY'
}

/**
 * Phase 7R.3.11.2 — accidental-fullscreen detector for NON-root utility
 * children. A small control (toolbar/navigator/button/toast) must never be
 * near-viewport-sized; that is the exact white-screen occlusion mode caused
 * by the ownership selector carrying viewport geometry.
 */
export function isAccidentalFullscreenChild(
  childRect: { width: number; height: number } | null,
  viewport: { width: number; height: number },
): boolean {
  if (!childRect || childRect.width <= 0 || childRect.height <= 0) return false
  return childRect.width >= viewport.width * 0.8 && childRect.height >= viewport.height * 0.8
}

/** Fraction of the editor area covered by a child rect (0..1). */
export function computeOcclusionRatio(
  childRect: { left: number; top: number; right: number; bottom: number } | null,
  editorRect: { left: number; top: number; right: number; bottom: number } | null,
): number {
  if (!childRect || !editorRect) return 0
  const editorArea = Math.max(0, (editorRect.right - editorRect.left) * (editorRect.bottom - editorRect.top))
  if (editorArea === 0) return 0
  const overlapLeft = Math.max(childRect.left, editorRect.left)
  const overlapTop = Math.max(childRect.top, editorRect.top)
  const overlapRight = Math.min(childRect.right, editorRect.right)
  const overlapBottom = Math.min(childRect.bottom, editorRect.bottom)
  if (overlapRight <= overlapLeft || overlapBottom <= overlapTop) return 0
  const overlapArea = (overlapRight - overlapLeft) * (overlapBottom - overlapTop)
  return Math.min(1, overlapArea / editorArea)
}

/**
 * Phase 7R.3.11.3 — resize source classification.
 * A geometry write triggered by a ResizeObserver callback on the same shell,
 * with NO viewport change and almost no time gap, is a genuine utility
 * feedback loop. Viewport changes = external (DevTools/window) resize.
 */
export type ResizeSourceVerdict = 'EXTERNAL_LAYOUT_RESIZE' | 'UTILITY_FEEDBACK_LOOP' | 'INDETERMINATE'

export function classifyResizeSource(opts: {
  viewportWidthChanged: boolean
  msSinceUtilityWrite: number | null
  feedbackWindowMs: number
}): ResizeSourceVerdict {
  if (opts.viewportWidthChanged) return 'EXTERNAL_LAYOUT_RESIZE'
  if (opts.msSinceUtilityWrite != null && opts.msSinceUtilityWrite >= 0 && opts.msSinceUtilityWrite < opts.feedbackWindowMs) {
    return 'UTILITY_FEEDBACK_LOOP'
  }
  return 'INDETERMINATE'
}

export interface RectRecord {
  left: number
  top: number
  right: number
  bottom: number
  width: number
  height: number
}

function toRectRecord(r: DOMRect | null | undefined): RectRecord | null {
  if (!r) return null
  return { left: r.left, top: r.top, right: r.right, bottom: r.bottom, width: r.width, height: r.height }
}

export class DocumentUtilityOverlayHost {
  private root: HTMLDivElement | null = null
  private toolbarEl: HTMLDivElement | null = null
  private navigatorEl: HTMLDivElement | null = null
  private drawerEl: HTMLDivElement | null = null
  private drawerListEl: HTMLDivElement | null = null
  private diagButtonEl: HTMLButtonElement | null = null
  private lockButtonEl: HTMLButtonElement | null = null
  private topBtnEl: HTMLButtonElement | null = null
  private bottomBtnEl: HTMLButtonElement | null = null
  private drawerOpen = false
  private resizeObserver: ResizeObserver | null = null
  private geometryRafPending = false
  private pendingGeometryReasons = new Set<string>()
  private lastGeometry: OverlayGeometry | null = null
  private readonly geometryCounters = {
    windowResizeEventCount: 0,
    scheduleCount: 0,
    executionCount: 0,
    writeCount: 0,
    noopCount: 0,
    sameFrameCoalesceCount: 0,
    feedbackLoopSuspectCount: 0,
    feedbackLoopConfirmedCount: 0,
    utilityResizeEchoCount: 0,
    mixedCorrelationCount: 0,
    warningCorrelationCount: 0,
  }
  private externalResizeEpoch = 0
  private utilityWriteEpoch = 0
  private resizeObserverEpoch = 0
  private lastRoCallbackTs: number | null = null
  private lastGeometryWriteTs: number | null = null
  private lastWindowResizeTs: number | null = null
  private lastExternalResizeTs: number | null = null
  private lastWriteShellRect: RectRecord | null = null
  private geometryCommitted = false
  /** Phase 7R.3.11.8B.3 — DOCUMENT-UTILITY-OVERLAY-LAYOUT state-token dedup. */
  private lastOverlayLayoutSignature = ''
  private lastRoSawChangedShell = false
  /** Phase 7R.3.11.8B.3.1 — causal-token evidence for a confirmed loop. */
  private lastShellChangeObservedWriteEpoch = -1
  private lastGeometryWriteExternalEpoch = -1
  /** Phase 7R.3.11.8B.3.1 — read-only drawer content audit (rAF + DOM read only). */
  private drawerContentAuditRafPending = false
  private lastDrawerContentAuditSignature = ''
  private latestRects: {
    write: RectRecord | null
    visibleWrite: RectRecord | null
    shell: RectRecord | null
    overlayRoot: RectRecord | null
    toolbar: RectRecord | null
    navigator: RectRecord | null
    drawer: RectRecord | null
  } = {
    write: null, visibleWrite: null, shell: null, overlayRoot: null, toolbar: null, navigator: null, drawer: null,
  }
  private bcrEmitCount = 0
  private settleTimer: ReturnType<typeof setTimeout> | null = null
  private prevNavStateKey = ''
  private warningObserverInstalled = false
  private onWindowErrorBound = false

  readonly diagnostics: DocumentDiagnosticsAuthority
  readonly locator: DocumentDiagnosticLocator
  readonly editGuard: DocumentEditGuard
  private scrollNav: DocumentScrollNavigator | null = null
  /** Phase 7R.3.11.8-B — single active finite scroll operation (event-driven). */
  private scrollNavOperationSeq = 0
  private activeScrollOperation: ActiveScrollOperation | null = null
  private scrollOperationEmitCount = 0
  /** Phase 7R.3.11.8-B §3.6 — STRICT-SINGLE-H1 popup dedup (documentKey → violationFingerprint). */
  private strictSingleH1PopupTokens = new Map<string, string>()
  private strictSingleH1PopupEmitCount = 0
  /** Phase 7R.3.11.8-B §7 — event-driven diagnostics recompute (mutation → rAF, no polling). */
  private diagnosticsMutationObserver: MutationObserver | null = null
  private diagnosticsRafPending = false
  private snapshot: DocumentDiagnosticsSnapshot | null = null
  /** Phase 7R.3.11.8B.5 — multi-target locate cycle cursor per diagnosticId. */
  private multiTargetCursor = new Map<string, number>()
  private mounted = false
  private disposed = false
  private disposables: Array<() => void> = []

  constructor(private opts: DocumentUtilitiesOverlayOptions) {
    this.diagnostics = new DocumentDiagnosticsAuthority(opts.ctx, opts.providers)
    this.locator = new DocumentDiagnosticLocator({
      getContainer: () => getActiveEditorScrollContainer(),
      onStale: () => {
        // Target changed: refresh diagnostics and surface a stale notice.
        this.diagnostics.recompute()
        this.showToast('目标已变化，请重新检查')
      },
    })
    this.editGuard = new DocumentEditGuard({
      getDocumentKey: () => opts.ctx.authority.getDocumentKey(),
    })
  }

  // ── Mount / dispose ─────────────────────────────────
  mount(): void {
    if (this.mounted || this.disposed) return
    this.mounted = true

    // Phase 7R.3.11.1 (Strategy B): the overlay root is a FULL-VIEWPORT fixed
    // layer so absolute-positioned children (toolbar/navigator/drawer) use the
    // viewport as their containing block. A 0×0 root is NOT a usable containing
    // block: `right`/`bottom` on absolute children would push them off-screen.
    const root = document.createElement('div')
    root.setAttribute(UTILITY_UI_ROOT_ATTR, UTILITY_UI_ROOT_VALUE)
    root.setAttribute(UTILITY_ROOT_IDENTITY_ATTR, 'true')
    root.style.cssText = 'position:fixed;inset:0;width:100vw;height:100vh;overflow:visible;pointer-events:none;z-index:900;'
    document.body.appendChild(root)
    this.root = root

    this.toolbarEl = this.buildToolbar(root)
    this.navigatorEl = this.buildNavigator(root)
    this.drawerEl = this.buildDrawer(root)

    // Scroll navigator lifecycle (one active listener).
    this.scrollNav = new DocumentScrollNavigator({
      getContainer: () => getActiveEditorScrollContainer(),
      onStateChange: (s) => this.renderNavState(s),
    })
    this.scrollNav.bind()

    // Placement sync — anchored to the editor shell rect. The ResizeObserver
    // callback only schedules ONE coalesced rAF; it never writes styles (no
    // geometry feedback loop). Callback counters feed the resize attribution.
    const container = getActiveEditorScrollContainer()
    if (container && typeof ResizeObserver !== 'undefined') {
      this.resizeObserver = new ResizeObserver(() => {
        this.resizeObserverEpoch++
        this.lastRoCallbackTs = this.now()
        // Phase 7R.3.11.4 — epoch-based attribution (no single-point width
        // comparison): externalRecent vs utilityWriteRecent within windows.
        const externalRecent = this.lastExternalResizeTs != null && this.now() - this.lastExternalResizeTs <= EXTERNAL_RESIZE_WINDOW_MS
        const utilityWriteRecent = this.lastGeometryWriteTs != null && this.now() - this.lastGeometryWriteTs <= UTILITY_WRITE_WINDOW_MS
        if (externalRecent && utilityWriteRecent) {
          this.geometryCounters.mixedCorrelationCount++
        } else if (!externalRecent && utilityWriteRecent) {
          this.geometryCounters.feedbackLoopSuspectCount++
        }
        // Phase 7R.3.11.8B.3.1 — a shell change can ONLY be attributed to OUR
        // write when no external resize occurred since that write (otherwise
        // the change is the lingering effect of an external resize → §5 B
        // FALSE_POSITIVE_ATTRIBUTION). The causal token (write epoch observed)
        // is recorded so `confirmed` can later require a NEW write2.
        const shellRectNow = container.getBoundingClientRect()
        const changed = this.lastWriteShellRect != null && Math.abs(shellRectNow.width - this.lastWriteShellRect.width) > 0.5
        const attributableToUtility = changed && this.lastGeometryWriteExternalEpoch === this.externalResizeEpoch
        if (!externalRecent && utilityWriteRecent && attributableToUtility) {
          this.lastRoSawChangedShell = true
          this.externalEpochAtLoopStart = this.externalResizeEpoch
          this.lastShellChangeObservedWriteEpoch = this.utilityWriteEpoch
        } else if (externalRecent) {
          this.lastRoSawChangedShell = false
        }
        this.scheduleGeometrySync('resize-observer')
      })
      this.resizeObserver.observe(container)
    }
    // Phase 7R.3.11.8B.3 — observe the CONTENT root too: its box grows with
    // content, so short→long/long→short navigator visibility stays live
    // without any polling (same RO, same coalesced rAF, no new observer).
    const contentRoot = resolveBusinessContentRoot()
    if (contentRoot && this.resizeObserver && typeof ResizeObserver !== 'undefined') {
      this.resizeObserver.observe(contentRoot)
    }
    window.addEventListener('resize', this.onWindowResize)
    this.installWarningObserver()
    this.scheduleGeometrySync('mount')

    // Diagnostics subscription → toolbar badge + live drawer re-render.
    this.disposables.push(this.diagnostics.subscribe((snapshot) => {
      // Phase 7R.3.11.4 — stale-publish guard: a snapshot whose documentKey no
      // longer matches the active document must be DISCARDED (never rendered).
      const activeKey = this.opts.ctx.authority.getDocumentKey()
      if (snapshot && snapshot.documentKey !== activeKey) {
        emitRuntimeAudit('DOCUMENT-UTILITY-DIAGNOSTIC-SNAPSHOT', {
          action: 'DISCARDED_STALE',
          documentKey: snapshot.documentKey,
          activeDocumentKey: activeKey,
          revision: snapshot.revision,
          sourceRevision: snapshot.sourceRevision,
          itemCount: snapshot.diagnostics.length,
          decision: 'STALE_DIAGNOSTIC_PUBLISH_DISCARDED',
        })
        return
      }
      this.snapshot = snapshot
      this.handleStrictSingleH1Popup(snapshot)
      this.renderDiagnosticsButton()
      if (this.drawerOpen) {
        // Drawer stays open and re-renders IN PLACE with the new snapshot.
        this.renderDrawer()
      }
      if (snapshot) {
        emitRuntimeAudit('DOCUMENT-UTILITY-DIAGNOSTIC-SNAPSHOT', {
          action: 'PUBLISHED',
          documentKey: snapshot.documentKey,
          activeDocumentKey: activeKey,
          revision: snapshot.revision,
          sourceRevision: snapshot.sourceRevision,
          drawerVisible: this.drawerOpen,
          itemCount: snapshot.diagnostics.length,
          errorCount: snapshot.errorCount,
          warningCount: snapshot.warningCount,
          hintCount: snapshot.infoCount,
          // Phase 7R.3.11.8B.4.1 — per-item codes for runtime acceptance
          // (observability only; never affects layout/geometry).
          codes: snapshot.diagnostics.map(d => `${d.severity}:${d.code}:${d.targetIdentity ?? ''}`),
          snapshotMatchesActiveDocument: snapshot.documentKey === activeKey,
          decision: snapshot.documentKey === activeKey ? 'PUBLISHED_MATCHES_ACTIVE' : 'PUBLISHED_MISMATCH',
        })
      }
    }))

    // Initial recompute (event-driven — the caller controls further triggers).
    this.diagnostics.recompute()

    // Phase 7R.3.11.8-B §7 — live diagnostics triggers (frame commit / mode
    // change) → lightweight recompute only.
    this.opts.onDiagnosticsTrigger?.(() => this.diagnostics.recompute())

    // Phase 7R.3.11.8-B §7 — event-driven editor mutation trigger (rAF-coalesced).
    // Covers raw source / trailing-blank-line changes and live heading edits.
    // NEVER a timer/poll: fires only on actual #write mutations. Recompute is
    // read-only (no DOM write), so there is no feedback loop.
    const editorRoot = resolveBusinessContentRoot()
    if (editorRoot && typeof MutationObserver === 'function') {
      this.diagnosticsMutationObserver = new MutationObserver(() => {
        if (this.disposed) return
        // Phase 7R.3.11.8B.3 — content mutation also re-measures navigator
        // visibility (event-driven, rAF-coalesced; never a timer/poll).
        if (!this.diagnosticsRafPending) {
          this.diagnosticsRafPending = true
          requestAnimationFrame(() => {
            this.diagnosticsRafPending = false
            if (this.disposed) return
            this.diagnostics.recompute()
            this.scheduleGeometrySync('content-mutation')
          })
        }
      })
      this.diagnosticsMutationObserver.observe(editorRoot, { childList: true, characterData: true, subtree: true })
    }

    // Bind to the current document.
    this.opts.onBindDocument?.(() => this.bindDocument())

    emitRuntimeAudit('DOCUMENT-UTILITY-LIFECYCLE', {
      action: 'MOUNTED',
      rootCount: document.querySelectorAll(`[${UTILITY_ROOT_IDENTITY_ATTR}="true"]`).length,
      toolbarCount: document.querySelectorAll('.inkchapter-doc-toolbar').length,
      navigatorCount: document.querySelectorAll('.inkchapter-doc-navigator').length,
      drawerCount: document.querySelectorAll('.inkchapter-doc-drawer').length,
      rootConnected: this.root?.isConnected ?? false,
      editorRootConnected: resolveBusinessContentRoot()?.isConnected ?? false,
      scrollContainerConnected: getActiveEditorScrollContainer()?.isConnected ?? false,
    })
    console.log('[InkChapter] DOCUMENT-UTILITY-LIFECYCLE action=MOUNTED rootConnected=' + (this.root?.isConnected ?? false))
    this.emitFullBcr('mount')
  }

  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    this.mounted = false
    for (const d of this.disposables) d()
    this.disposables = []
    this.resizeObserver?.disconnect()
    this.resizeObserver = null
    window.removeEventListener('resize', this.onWindowResize)
    if (this.onWindowErrorBound) {
      window.removeEventListener('error', this.onWindowErrorCapture, true)
      this.onWindowErrorBound = false
    }
    if (this.settleTimer) {
      clearTimeout(this.settleTimer)
      this.settleTimer = null
    }
    this.scrollNav?.dispose()
    this.scrollNav = null
    // Phase 7R.3.11.8-B: release any in-flight scroll operation.
    this.cancelScrollOperation('SUPERSEDED')
    // Phase 7R.3.11.8-B: disconnect the diagnostics mutation observer.
    this.diagnosticsMutationObserver?.disconnect()
    this.diagnosticsMutationObserver = null
    this.diagnosticsRafPending = false
    this.editGuard.dispose()
    this.root?.remove()
    this.root = null
    emitRuntimeAudit('DOCUMENT-UTILITY-LIFECYCLE', {
      action: 'DISPOSE',
      rootCount: document.querySelectorAll(`[${UTILITY_ROOT_IDENTITY_ATTR}="true"]`).length,
    })
  }

  /** Rebind document context (document switch): scroll, diagnostics, lock. */
  bindDocument(): void {
    // Phase 7R.3.11.8-B §11: a document switch CANCELS any in-flight scroll
    // operation (old doc must never write final state into the new document).
    this.cancelScrollOperation('CANCELLED_DOCUMENT_SWITCH')
    this.scrollNav?.bind()
    this.diagnostics.rebind()
    this.scheduleGeometrySync('bind-document')
    this.renderLockButton()
    this.emitFullBcr('document-switch')
    // Phase 7R.3.11.7 §32/§33: event-triggered settle summary (no timer).
    emitInkchapterRuntimeAuditSummary('document-switch-settled')
    emitRuntimeAudit('DOCUMENT-UTILITY-LIFECYCLE', {
      action: 'BIND_DOCUMENT',
      rootCount: document.querySelectorAll(`[${UTILITY_ROOT_IDENTITY_ATTR}="true"]`).length,
      toolbarCount: document.querySelectorAll('.inkchapter-doc-toolbar').length,
      navigatorCount: document.querySelectorAll('.inkchapter-doc-navigator').length,
    })
  }

  /** Runtime-gate observability: resize/geometry counters (read-only). */
  getGeometryCounters(): {
    /** Phase 7R.3.11.5 — derived from resizeObserverEpoch (single authority). */
    resizeObserverCallbackCount: number
    windowResizeEventCount: number
    scheduleCount: number
    executionCount: number
    writeCount: number
    noopCount: number
    sameFrameCoalesceCount: number
    feedbackLoopSuspectCount: number
    feedbackLoopConfirmedCount: number
    utilityResizeEchoCount: number
    mixedCorrelationCount: number
    warningCorrelationCount: number
    externalResizeEpoch: number
    utilityWriteEpoch: number
    resizeObserverEpoch: number
  } {
    return {
      resizeObserverCallbackCount: this.resizeObserverEpoch,
      ...this.geometryCounters,
      externalResizeEpoch: this.externalResizeEpoch,
      utilityWriteEpoch: this.utilityWriteEpoch,
      resizeObserverEpoch: this.resizeObserverEpoch,
    }
  }

  /** Runtime-gate observability: first geometry write committed. */
  isGeometryCommitted(): boolean {
    return this.geometryCommitted
  }

  /** Runtime-gate observability: full-BCR emission count (log-reduction gate). */
  getBcrEmitCount(): number {
    return this.bcrEmitCount
  }

  /** Runtime-gate observability: overlay root is a full-viewport layer. */
  isRootViewportSized(): boolean {
    const s = this.root?.style ?? null
    return !!s && s.width === '100vw' && s.height === '100vh'
  }

  private now(): number {
    return typeof performance !== 'undefined' ? performance.now() : Date.now()
  }

  private onWindowResize = (): void => {
    this.geometryCounters.windowResizeEventCount++
    this.externalResizeEpoch++
    this.lastWindowResizeTs = this.now()
    this.lastExternalResizeTs = this.now()
    this.scheduleGeometrySync('window-resize')
    this.scheduleResizeSettle()
  }

  /**
   * Low-noise ResizeObserver-loop warning observer: counts the global
   * `ResizeObserver loop limit exceeded` error and correlates it with the last
   * utility write / window resize. Never suppresses or modifies the error.
   */
  private installWarningObserver(): void {
    if (this.warningObserverInstalled || this.disposed) return
    this.warningObserverInstalled = true
    if (!this.onWindowErrorBound) {
      window.addEventListener('error', this.onWindowErrorCapture, true)
      this.onWindowErrorBound = true
    }
  }

  private onWindowErrorCapture = (e: ErrorEvent): void => {
    if (!e || typeof e.message !== 'string') return
    if (!/ResizeObserver loop/i.test(e.message)) return
    const now = this.now()
    const deltaFromWrite = this.lastGeometryWriteTs == null ? null : now - this.lastGeometryWriteTs
    const deltaFromResize = this.lastWindowResizeTs == null ? null : now - this.lastWindowResizeTs
    const correlatedToUtility = deltaFromWrite != null && deltaFromWrite < 100
    const correlatedToExternal = deltaFromResize != null && deltaFromResize < 100
    if (correlatedToUtility || correlatedToExternal) this.geometryCounters.warningCorrelationCount++
    emitRuntimeAudit('DOCUMENT-UTILITY-RESIZE-WARNING', {
      message: e.message,
      lastRoCallbackTs: this.lastRoCallbackTs,
      lastGeometryWriteTs: this.lastGeometryWriteTs,
      lastWindowResizeTs: this.lastWindowResizeTs,
      warningDeltaFromUtilityWriteMs: deltaFromWrite,
      warningDeltaFromWindowResizeMs: deltaFromResize,
      correlatedToUtility,
      correlatedToExternal,
    })
  }

  // ── Placement (coalesced, read/write separated) ─────
  private scheduleGeometrySync(reason: string): void {
    if (!this.root) return
    // Phase 7R.3.11.6 — coalescing must NOT drop drawer-open/close semantics:
    // every reason is preserved; execution reads the LIVE drawer state.
    this.pendingGeometryReasons.add(reason)
    if (this.geometryRafPending) {
      this.geometryCounters.sameFrameCoalesceCount++
      return
    }
    this.geometryRafPending = true
    this.geometryCounters.scheduleCount++
    const run = (): void => {
      this.geometryRafPending = false
      const reasons = new Set(this.pendingGeometryReasons)
      this.pendingGeometryReasons.clear()
      this.applyGeometry(reasons)
    }
    if (typeof requestAnimationFrame === 'function') {
      requestAnimationFrame(run)
    } else {
      run() // jsdom / environments without rAF
    }
  }

  /** Event-driven resize-settle debounce — forensic summary ONLY (no business UI). */
  private scheduleResizeSettle(): void {
    if (this.settleTimer) clearTimeout(this.settleTimer)
    this.settleTimer = setTimeout(() => {
      this.settleTimer = null
      this.emitResizeSummary()
    }, 200)
  }

  private refreshLatestRects(): void {
    const write = resolveBusinessContentRoot()?.getBoundingClientRect() ?? null
    const shell = getActiveEditorScrollContainer()?.getBoundingClientRect() ?? null
    const overlayRoot = this.root?.getBoundingClientRect() ?? null
    const toolbar = this.toolbarEl?.getBoundingClientRect() ?? null
    const navigator = this.navigatorEl?.getBoundingClientRect() ?? null
    const drawer = this.drawerEl?.getBoundingClientRect() ?? null
    const writeRec = toRectRecord(write)
    const shellRec = toRectRecord(shell)
    this.latestRects = {
      write: writeRec,
      // Phase 7R.3.11.4 — occlusion denominator = VISIBLE write area only.
      visibleWrite: intersectRects(writeRec, shellRec),
      shell: shellRec,
      overlayRoot: toRectRecord(overlayRoot),
      toolbar: toRectRecord(toolbar),
      navigator: toRectRecord(navigator),
      drawer: toRectRecord(drawer),
    }
  }

  private applyGeometry(reasons: Set<string>): void {
    if (!this.root) return
    this.geometryCounters.executionCount++
    const container = getActiveEditorScrollContainer()
    const rect = container?.getBoundingClientRect()
    // Phase 7R.3.11.8B.3 — live scrollability from the SAME container the
    // Scroll Operation uses (scrollHeight/clientHeight; never字数/block count).
    const scrollHeight = container ? container.scrollHeight : 0
    const clientHeight = container ? container.clientHeight : 0
    // Phase 7R.3.11.6 — execution reads the LIVE drawerOpen (never a schedule-time snapshot).
    const next = computeOverlayGeometry(
      rect && rect.width > 0 ? { top: rect.top, right: rect.right, bottom: rect.bottom } : null,
      { width: window.innerWidth, height: window.innerHeight },
      { drawerOpen: this.drawerOpen, scrollHeight, clientHeight },
    )
    const hasDrawerTransition = reasons.has('drawer-open') || reasons.has('drawer-close')
    const prev = this.lastGeometry
    this.lastGeometry = next
    if (prev && JSON.stringify(prev) === JSON.stringify(next)) {
      this.geometryCounters.noopCount++
      // Phase 7R.3.11.8B.3.1 — §5 C UTILITY_RESIZE_ECHO: a write → one RO
      // callback → geometry noop terminates the causal token. This is NOT a
      // loop; the flag is cleared so an unrelated later write can never confirm.
      if (this.lastRoSawChangedShell) {
        this.geometryCounters.utilityResizeEchoCount++
        this.lastRoSawChangedShell = false
      }
      // State changed but geometry is already correct (e.g. rapid toggle
      // ending where it started): still report the state-specific placement.
      if (hasDrawerTransition) {
        const commitReason = this.drawerOpen ? 'drawer-open-committed' : 'drawer-close-committed'
        // Phase 7R.3.11.6 — drawer open/close is a BCR milestone even when the
        // geometry object is unchanged (8B.3 independent anchors make the
        // drawer transition a noop; the milestone audit must still fire).
        this.emitFullBcr(commitReason)
        this.emitNavigatorPlacementAudit(commitReason)
      }
      this.emitOverlayLayoutAudit(next, scrollHeight, clientHeight)
      return
    }
    this.geometryCounters.writeCount++
    this.utilityWriteEpoch++
    this.lastGeometryWriteTs = this.now()
    // Phase 7R.3.11.8B.3.1 — record the external epoch at this write so the RO
    // callback can tell whether an external resize invalidates attribution.
    this.lastGeometryWriteExternalEpoch = this.externalResizeEpoch
    if (this.toolbarEl) {
      this.toolbarEl.style.top = `${next.toolbarTop}px`
      this.toolbarEl.style.right = `${next.toolbarRight}px`
    }
    if (this.navigatorEl) {
      // Phase 7R.3.11.8B.3 — hidden when the real container is not scrollable;
      // display:none removes hit-targets, focus and keyboard reachability.
      this.navigatorEl.style.display = next.navigatorVisible ? 'flex' : 'none'
      this.navigatorEl.style.right = `${next.navRight}px`
      this.navigatorEl.style.bottom = `${next.navBottom}px`
    }
    if (this.drawerEl) {
      // Phase 7R.3.11.8B.3 — drawer is top-right anchored, content-sized
      // (height:auto), capped by maxHeight; never stretched by a bottom offset.
      this.drawerEl.style.top = `${next.drawerTop}px`
      this.drawerEl.style.right = `${next.drawerRight}px`
      this.drawerEl.style.bottom = ''
      this.drawerEl.style.maxHeight = `${next.drawerMaxHeight}px`
    }
    // Phase 7R.3.11.8B.3.1 — §5 A TRUE_FEEDBACK_LOOP requires the full causal
    // token write1 → RO callback → write2: the current write must be a NEW
    // write strictly after the callback observed the change (utilityWriteEpoch
    // increased), and no external resize may have intervened.
    if (
      this.lastRoSawChangedShell
      && this.utilityWriteEpoch > this.lastShellChangeObservedWriteEpoch
      && this.externalResizeEpoch === this.externalEpochAtLoopStart
    ) {
      this.geometryCounters.feedbackLoopConfirmedCount++
    }
    this.lastRoSawChangedShell = false
    this.lastWriteShellRect = this.latestRects.shell
    const firstCommit = !this.geometryCommitted
    this.geometryCommitted = true
    // In-memory rects stay fresh during bursts; full BCR is milestone-only.
    this.refreshLatestRects()
    this.emitGeometryAndVisibility([...reasons].join(','), next)
    this.emitOverlayLayoutAudit(next, scrollHeight, clientHeight)
    if (this.drawerOpen) this.emitCollisionAudit()
    if (firstCommit) {
      this.emitFullBcr('first-geometry-commit')
    }
    // Phase 7R.3.11.6 — POST-COMMIT drawer BCR + NAV-PLACEMENT audit
    // (never pre-commit: the committed geometry is the final authority).
    if (hasDrawerTransition) {
      const commitReason = this.drawerOpen ? 'drawer-open-committed' : 'drawer-close-committed'
      this.emitFullBcr(commitReason)
      this.emitNavigatorPlacementAudit(commitReason)
      // Phase 7R.3.11.7 §32/§33: event-triggered settle summary (no timer).
      emitInkchapterRuntimeAuditSummary('drawer-transition-settled', { commitReason })
    }
  }

  /**
   * Phase 7R.3.11.8B.3 — low-noise overlay layout audit (state-token deduped).
   * Suppresses identical (documentKey, scrollable, navigatorVisible, drawerVisible,
   * drawerItemCount, rendered-height bucket) repeats; transitions always emit.
   */
  private emitOverlayLayoutAudit(g: OverlayGeometry, scrollHeight: number, clientHeight: number): void {
    const drawerItemCount = this.drawerEl ? this.drawerEl.querySelectorAll('.inkchapter-doc-drawer__item').length : 0
    const renderedHeight = this.drawerEl ? this.drawerEl.getBoundingClientRect().height : 0
    const heightBucket = Math.round(renderedHeight / 20)
    const signature = `${this.opts.ctx.authority.getDocumentKey() ?? ''}|${g.scrollable}|${g.navigatorVisible}|${this.drawerOpen}|${drawerItemCount}|${heightBucket}`
    if (signature === this.lastOverlayLayoutSignature) return
    this.lastOverlayLayoutSignature = signature
    const decision = !g.navigatorVisible
      ? 'SHORT_DOCUMENT_NAV_HIDDEN'
      : this.drawerOpen
        ? (g.drawerMaxHeight > 0 && renderedHeight >= g.drawerMaxHeight - 2 ? 'DRAWER_MAX_HEIGHT_SCROLL' : 'DRAWER_CONTENT_FIT')
        : 'SCROLLABLE_DOCUMENT_NAV_VISIBLE'
    emitRuntimeAudit('DOCUMENT-UTILITY-OVERLAY-LAYOUT', {
      documentKey: this.opts.ctx.authority.getDocumentKey(),
      scrollHeight,
      clientHeight,
      maxScrollTop: Math.max(0, scrollHeight - clientHeight),
      scrollable: g.scrollable,
      navigatorVisible: g.navigatorVisible,
      navigatorRight: g.navRight,
      navigatorBottom: g.navBottom,
      drawerVisible: this.drawerOpen,
      drawerItemCount,
      drawerContentHeight: renderedHeight,
      drawerMaxHeight: g.drawerMaxHeight,
      drawerRenderedHeight: renderedHeight,
      drawerBodyScrollable: this.drawerOpen && g.drawerMaxHeight > 0 && renderedHeight >= g.drawerMaxHeight - 2,
      decision,
    })
  }

  /**
   * Phase 7R.3.11.8B.3.1 — Drawer rerender read-only layout audit.
   * After renderDrawer() the DOM is authoritative; this schedules ONE rAF that
   * ONLY reads the drawer box + list scroll metrics and emits the latest state.
   * It NEVER calls applyGeometry and never writes styles → geometryWriteDelta=0.
   * State-token dedup suppresses identical (docKey, drawerVisible, itemCount,
   * rendered-height bucket, bodyScrollable) repeats.
   */
  private scheduleDrawerContentAudit(): void {
    if (this.drawerContentAuditRafPending || this.disposed) return
    this.drawerContentAuditRafPending = true
    const run = (): void => {
      this.drawerContentAuditRafPending = false
      if (this.disposed || !this.drawerEl || !this.drawerListEl) return
      const writeCountBefore = this.geometryCounters.writeCount
      const drawerRect = this.drawerEl.getBoundingClientRect()
      const listScrollHeight = this.drawerListEl.scrollHeight
      const listClientHeight = this.drawerListEl.clientHeight
      const itemCount = this.drawerEl.querySelectorAll('.inkchapter-doc-drawer__item').length
      const renderedHeight = drawerRect.height
      const maxHeight = this.drawerEl.style.maxHeight ? Number.parseInt(this.drawerEl.style.maxHeight) : 0
      const bodyScrollable = maxHeight > 0 && listScrollHeight > listClientHeight && renderedHeight >= maxHeight - 2
      const heightBucket = Math.round(renderedHeight / 20)
      const signature = `${this.opts.ctx.authority.getDocumentKey() ?? ''}|${this.drawerOpen}|${itemCount}|${heightBucket}|${bodyScrollable}`
      const writeCountAfter = this.geometryCounters.writeCount
      if (signature !== this.lastDrawerContentAuditSignature) {
        this.lastDrawerContentAuditSignature = signature
        emitRuntimeAudit('DOCUMENT-UTILITY-DRAWER-CONTENT-LAYOUT', {
          documentKey: this.opts.ctx.authority.getDocumentKey(),
          drawerVisible: this.drawerOpen,
          itemCount,
          drawerRenderedHeight: renderedHeight,
          drawerMaxHeight: maxHeight,
          listScrollHeight,
          listClientHeight,
          drawerBodyScrollable: bodyScrollable,
          geometryWriteBefore: writeCountBefore,
          geometryWriteAfter: writeCountAfter,
          geometryWriteDelta: writeCountAfter - writeCountBefore,
          readOnly: true,
        })
      }
    }
    if (typeof requestAnimationFrame === 'function') {
      requestAnimationFrame(run)
    } else {
      run()
    }
  }

  private externalEpochAtLoopStart = -1

  private emitGeometryAndVisibility(reason: string, g: OverlayGeometry): void {
    const viewport = { width: window.innerWidth, height: window.innerHeight }
    emitRuntimeAudit('DOCUMENT-UTILITY-GEOMETRY', {
      reason,
      viewport,
      drawerOpen: this.drawerOpen,
      writeRect: this.latestRects.write ? { left: this.latestRects.write.left, top: this.latestRects.write.top, right: this.latestRects.write.right, bottom: this.latestRects.write.bottom, width: this.latestRects.write.width, height: this.latestRects.write.height } : null,
      visibleWriteRect: this.latestRects.visibleWrite,
      editorShellRect: this.latestRects.shell ? { left: this.latestRects.shell.left, top: this.latestRects.shell.top, right: this.latestRects.shell.right, bottom: this.latestRects.shell.bottom, width: this.latestRects.shell.width, height: this.latestRects.shell.height } : null,
      toolbarRect: this.toolbarEl ? { top: g.toolbarTop, right: g.toolbarRight } : null,
      navigatorRect: this.navigatorEl ? { right: g.navRight, bottom: g.navBottom } : null,
    })
    emitRuntimeAudit('DOCUMENT-UTILITY-VISIBILITY', {
      toolbarDisplay: this.toolbarEl ? getComputedStyle(this.toolbarEl).display : null,
      toolbarVisibility: this.toolbarEl ? getComputedStyle(this.toolbarEl).visibility : null,
      toolbarOpacity: this.toolbarEl ? getComputedStyle(this.toolbarEl).opacity : null,
      navigatorDisplay: this.navigatorEl ? getComputedStyle(this.navigatorEl).display : null,
      navigatorVisibility: this.navigatorEl ? getComputedStyle(this.navigatorEl).visibility : null,
      navigatorOpacity: this.navigatorEl ? getComputedStyle(this.navigatorEl).opacity : null,
    })
  }

  /**
   * Full BCR audit — milestone-only (mount / document switch / drawer open /
   * drawer close / lock transition / scroll-nav transition / resize-settled).
   * NOT emitted on every geometry write during continuous resize.
   * Phase 7R.3.11.4 — verdict must be GEOMETRY_PENDING until the first geometry
   * commit and until toolbar/navigator are actually inside the editor shell.
   */
  private emitFullBcr(reason: string): void {
    this.refreshLatestRects()
    this.bcrEmitCount++
    const viewport = { width: window.innerWidth, height: window.innerHeight }
    const r = this.latestRects
    const toolbarFullscreen = isAccidentalFullscreenChild(r.toolbar, viewport)
    const navigatorFullscreen = isAccidentalFullscreenChild(r.navigator, viewport)
    const drawerFullscreen = r.drawer ? r.drawer.width >= viewport.width * 0.8 && r.drawer.height >= viewport.height * 0.8 : false
    const toolbarInside = this.isInsideEditorShell(r.toolbar, r.shell)
    const navigatorInside = this.isInsideEditorShell(r.navigator, r.shell)
    const toolbarVisible = !!r.toolbar && r.toolbar.width > 0 && r.toolbar.height > 0 && !toolbarFullscreen && toolbarInside
    const navigatorVisible = !!r.navigator && r.navigator.width > 0 && r.navigator.height > 0 && !navigatorFullscreen && navigatorInside
    const committed = this.geometryCommitted
    const navigatorExpectedVisible = this.getNavigatorExpectedVisible()
    const placementFailure = this.computePlacementFailure()
    const decision = computeBcrVerdict({
      geometryCommitted: committed,
      toolbarInsideEditorShell: toolbarInside,
      navigatorInsideEditorShell: navigatorInside,
      toolbarVisible,
      navigatorVisible,
      navigatorExpectedVisible,
      toolbarFullscreen,
      navigatorFullscreen,
      drawerFullscreen,
      stateSpecificPlacementValid: placementFailure === null,
      placementFailure,
    })
    emitRuntimeAudit('DOCUMENT-UTILITY-BCR', {
      reason,
      geometryCommitted: committed,
      navigatorExpectedVisible,
      viewportWidth: viewport.width,
      viewportHeight: viewport.height,
      writeRect: r.write,
      visibleWriteRect: r.visibleWrite,
      editorShellRect: r.shell,
      scrollViewportRect: r.shell,
      overlayRootRect: r.overlayRoot,
      toolbarRect: r.toolbar,
      navigatorRect: r.navigator,
      drawerVisible: this.drawerOpen,
      drawerRect: r.drawer,
      toolbarFullscreen,
      navigatorFullscreen,
      drawerFullscreen,
      toolbarWriteOcclusionRatio: computeOcclusionRatio(r.toolbar, r.write),
      navigatorWriteOcclusionRatio: computeOcclusionRatio(r.navigator, r.write),
      drawerWriteOcclusionRatio: computeOcclusionRatio(r.drawer, r.write),
      toolbarVisibleWriteOcclusionRatio: computeOcclusionRatio(r.toolbar, r.visibleWrite),
      navigatorVisibleWriteOcclusionRatio: computeOcclusionRatio(r.navigator, r.visibleWrite),
      drawerVisibleWriteOcclusionRatio: computeOcclusionRatio(r.drawer, r.visibleWrite),
      toolbarInsideEditorShell: toolbarInside,
      navigatorInsideEditorShell: navigatorInside,
      decision,
    })
  }

  private isInsideEditorShell(child: RectRecord | null, shell: RectRecord | null): boolean {
    if (!child || !shell) return false
    const t = 8
    return child.left >= shell.left - t && child.right <= shell.right + t && child.top >= shell.top - t && child.bottom <= shell.bottom + t
  }

  private emitCollisionAudit(): void {
    const drawer = this.latestRects.drawer
    const navigator = this.latestRects.navigator
    const intersectionArea = rectIntersectionArea(drawer, navigator)
    emitRuntimeAudit('DOCUMENT-UTILITY-LAYOUT-COLLISION', {
      drawerVisible: this.drawerOpen,
      drawerRect: drawer,
      navigatorRect: navigator,
      intersectionArea,
      decision: this.drawerOpen && intersectionArea > 2 ? 'FAIL_COLLISION' : 'PASS',
    })
  }

  /**
   * Phase 7R.3.11.8B.3.1 — SINGLE scrollability authority reused by every audit
   * (placement / BCR / invariant). Never a second scrollability computation.
   */
  private getNavigatorExpectedVisible(): boolean {
    return this.lastGeometry?.navigatorVisible ?? false
  }

  /**
   * Phase 7R.3.11.6 — state-specific placement failure detector. Uses the SAME
   * geometry helper as production (no second formula): expectedRight is the
   * drawer-state-dependent navRight; actualRight = innerWidth - navRect.right.
   * Phase 7R.3.11.8B.3.1 — a legally-hidden navigator (expectedVisible=false)
   * is NOT a placement failure.
   */
  private computePlacementFailure(): NavigatorPlacementFailure | null {
    const result = evaluateNavigatorPlacement({
      drawerOpen: this.drawerOpen,
      navigatorExpectedVisible: this.getNavigatorExpectedVisible(),
      navigatorRect: this.latestRects.navigator,
      shellRect: this.latestRects.shell,
      viewport: { width: window.innerWidth, height: window.innerHeight },
      tolerancePx: NAV_PLACEMENT_TOLERANCE_PX,
    })
    return result.decision === 'PASS' ? null : (result.decision === 'NOT_EVALUATED' ? null : result.decision)
  }

  /** Phase 7R.3.11.6 — NAV-PLACEMENT runtime audit (post-commit only). */
  private emitNavigatorPlacementAudit(reason: string): void {
    const viewport = { width: window.innerWidth, height: window.innerHeight }
    const nav = this.latestRects.navigator
    const drawer = this.latestRects.drawer
    const expectedVisible = this.getNavigatorExpectedVisible()
    const result = evaluateNavigatorPlacement({
      drawerOpen: this.drawerOpen,
      navigatorExpectedVisible: expectedVisible,
      navigatorRect: nav,
      shellRect: this.latestRects.shell,
      viewport,
      tolerancePx: NAV_PLACEMENT_TOLERANCE_PX,
    })
    const intersectionArea = rectIntersectionArea(drawer, nav)
    const gapPx = drawer && nav ? Math.max(0, drawer.left - nav.right) : -1
    emitRuntimeAudit('DOCUMENT-UTILITY-NAV-PLACEMENT', {
      documentKey: this.opts.ctx.authority.getDocumentKey(),
      reason,
      drawerOpen: this.drawerOpen,
      navigatorExpectedVisible: expectedVisible,
      geometryCommitted: this.geometryCommitted,
      viewportWidth: viewport.width,
      editorShellRight: this.latestRects.shell?.right ?? null,
      drawerLeft: drawer?.left ?? null,
      drawerRight: drawer?.right ?? null,
      drawerWidth: drawer?.width ?? null,
      navigatorLeft: nav?.left ?? null,
      navigatorRight: nav?.right ?? null,
      expectedRight: result.expectedRight,
      actualRight: result.actualRight,
      rightDelta: result.rightDelta,
      intersectionArea,
      gapPx,
      decision: result.decision,
      decisionReason: result.reason,
    })
    // Phase 7R.3.11.8B.3 — NAVIGATOR-POSITION-INVARIANT: opening/closing the
    // drawer must NOT move the navigator (deltaX/deltaY <= 1px). State-token
    // deduped; transitions + FAIL always emit.
    const afterNav = this.latestRects.navigator
    const before = this.navRectBeforeDrawerToggle
    const navHidden = !afterNav || afterNav.width <= 0 || afterNav.height <= 0
    const deltaX = before && afterNav && !navHidden ? Math.abs(afterNav.right - before.right) : null
    const deltaY = before && afterNav && !navHidden ? Math.abs(afterNav.bottom - before.bottom) : null
    const pass = deltaX != null && deltaY != null && deltaX <= 1 && deltaY <= 1
    const invariantDecision = navHidden ? 'NOT_EVALUATED' : (pass ? 'PASS' : 'FAIL')
    const invariantReason = navHidden ? 'NAVIGATOR_HIDDEN' : (pass ? 'POSITION_STABLE' : 'POSITION_DRIFT')
    const signature = `${invariantReason}|${invariantDecision}|${deltaX}|${deltaY}|${this.drawerOpen}`
    if (signature !== this.lastNavPositionInvariantSignature) {
      this.lastNavPositionInvariantSignature = signature
      emitRuntimeAudit('DOCUMENT-UTILITY-NAVIGATOR-POSITION-INVARIANT', {
        documentKey: this.opts.ctx.authority.getDocumentKey(),
        drawerVisibleBefore: !this.drawerOpen,
        drawerVisibleAfter: this.drawerOpen,
        rightBefore: before?.right ?? null,
        rightAfter: afterNav?.right ?? null,
        bottomBefore: before?.bottom ?? null,
        bottomAfter: afterNav?.bottom ?? null,
        deltaX,
        deltaY,
        decision: invariantDecision,
        reason: invariantReason,
      })
    }
    // Phase 7R.3.11.8B.3.1 — DOCUMENT-UTILITY-NAVIGATOR-AUDIT-INVARIANT:
    // a legally-hidden navigator must be NOT_EVALUATED everywhere; a hidden
    // navigator reporting POSITION_DRIFT is an audit invariant FAIL.
    const overlayDecision = !expectedVisible ? 'SHORT_DOCUMENT_NAV_HIDDEN' : 'SCROLLABLE_DOCUMENT_NAV_VISIBLE'
    const auditPass = !expectedVisible ? result.decision === 'NOT_EVALUATED' : result.decision !== 'NOT_EVALUATED'
    emitRuntimeAudit('DOCUMENT-UTILITY-NAVIGATOR-AUDIT-INVARIANT', {
      documentKey: this.opts.ctx.authority.getDocumentKey(),
      expectedVisible,
      overlayDecision,
      placementDecision: result.decision,
      positionInvariantDecision: invariantDecision,
      decision: auditPass ? 'PASS' : 'FAIL',
    })
  }

  /** Phase 7R.3.11.8B.3 — navigator position captured before a drawer toggle. */
  private navRectBeforeDrawerToggle: { right: number; bottom: number } | null = null
  /** Phase 7R.3.11.8B.3 — NAVIGATOR-POSITION-INVARIANT state-token dedup. */
  private lastNavPositionInvariantSignature = ''

  private emitResizeSummary(): void {
    const viewport = { width: window.innerWidth, height: window.innerHeight }
    const verdict = classifyAttribution({
      feedbackLoopConfirmedCount: this.geometryCounters.feedbackLoopConfirmedCount,
      mixedCorrelationCount: this.geometryCounters.mixedCorrelationCount,
      externalResizeEpoch: this.externalResizeEpoch,
      warningCorrelationCount: this.geometryCounters.warningCorrelationCount,
    })
    // Phase 7R.3.11.5 — single callback-count authority: callbackCount derives
    // from resizeObserverEpoch, so difference is structurally 0.
    const consistency = computeAuditConsistency(this.resizeObserverEpoch, this.resizeObserverEpoch)
    emitRuntimeAudit('DOCUMENT-UTILITY-RESIZE-SUMMARY', {
      windowMs: Math.round(this.now()),
      resizeObserverCallbackCount: consistency.resizeObserverCallbackCount,
      windowResizeEventCount: this.geometryCounters.windowResizeEventCount,
      geometryScheduleCount: this.geometryCounters.scheduleCount,
      geometryExecutionCount: this.geometryCounters.executionCount,
      geometryWriteCount: this.geometryCounters.writeCount,
      geometryNoopCount: this.geometryCounters.noopCount,
      sameFrameCoalesceCount: this.geometryCounters.sameFrameCoalesceCount,
      feedbackLoopSuspectCount: this.geometryCounters.feedbackLoopSuspectCount,
      feedbackLoopConfirmedCount: this.geometryCounters.feedbackLoopConfirmedCount,
      utilityResizeEchoCount: this.geometryCounters.utilityResizeEchoCount,
      mixedCorrelationCount: this.geometryCounters.mixedCorrelationCount,
      warningCorrelationCount: this.geometryCounters.warningCorrelationCount,
      externalResizeEpoch: this.externalResizeEpoch,
      utilityWriteEpoch: this.utilityWriteEpoch,
      resizeObserverEpoch: this.resizeObserverEpoch,
      attributionVerdict: verdict,
      viewport,
    })
    emitRuntimeAudit('DOCUMENT-UTILITY-AUDIT-CONSISTENCY', consistency)
    // One full BCR at resize-settled (log-reduction gate).
    this.emitFullBcr('resize-settled')
  }

  // ── Toolbar ─────────────────────────────────────────
  private buildToolbar(root: HTMLDivElement): HTMLDivElement {
    const toolbar = document.createElement('div')
    toolbar.className = 'inkchapter-doc-toolbar'
    toolbar.setAttribute(UTILITY_UI_ROOT_ATTR, UTILITY_UI_ROOT_VALUE)
    toolbar.style.position = 'absolute'
    toolbar.style.pointerEvents = 'auto'

    const diagBtn = document.createElement('button')
    diagBtn.type = 'button'
    diagBtn.className = 'inkchapter-doc-toolbar__btn inkchapter-doc-toolbar__btn--diag'
    diagBtn.setAttribute(UTILITY_UI_ROOT_ATTR, UTILITY_UI_ROOT_VALUE)
    diagBtn.setAttribute('aria-label', '文档检测')
    diagBtn.title = '文档检测'
    diagBtn.textContent = '文档检测'
    diagBtn.addEventListener('click', () => this.toggleDrawer())
    this.diagButtonEl = diagBtn
    toolbar.appendChild(diagBtn)

    const lockBtn = document.createElement('button')
    lockBtn.type = 'button'
    lockBtn.className = 'inkchapter-doc-toolbar__btn inkchapter-doc-toolbar__btn--lock'
    lockBtn.setAttribute(UTILITY_UI_ROOT_ATTR, UTILITY_UI_ROOT_VALUE)
    lockBtn.setAttribute('aria-label', '编辑 / 已锁定')
    lockBtn.title = '编辑 / 已锁定'
    lockBtn.textContent = '编辑'
    lockBtn.addEventListener('click', () => this.toggleLock())
    this.lockButtonEl = lockBtn
    toolbar.appendChild(lockBtn)

    root.appendChild(toolbar)
    return toolbar
  }

  /**
   * Phase 7R.3.11.8-B §3.6 — STRICT-SINGLE-H1 popup with dedup.
   * Emits once per (documentKey + violationFingerprint) transition:
   *   NONE→ERROR, PASS→ERROR, SKIP→ERROR (and fingerprint change) → toast once;
   *   ERROR→PASS → clears the active violation token (re-arm for next ERROR).
   * State-transition logging only — no per-mutation spam.
   */
  private handleStrictSingleH1Popup(snapshot: DocumentDiagnosticsSnapshot | null): void {
    const docKey = snapshot?.documentKey ?? null
    if (docKey == null) return
    const violation = snapshot?.diagnostics.find(d =>
      d.code === 'STRICT_SINGLE_H1_NO_H1' || d.code === 'STRICT_SINGLE_H1_MULTIPLE_H1') ?? null
    if (violation) {
      const fingerprint = (violation.metadata?.violationFingerprint as string | undefined) ?? violation.code
      const prev = this.strictSingleH1PopupTokens.get(docKey)
      if (prev !== fingerprint) {
        this.strictSingleH1PopupTokens.set(docKey, fingerprint)
        this.strictSingleH1PopupEmitCount++
        this.showToast(violation.message.split('\n')[0])
        emitRuntimeAudit('DOCUMENT-UTILITY-STRICT-SINGLE-H1-POPUP', {
          documentKey: docKey,
          ruleId: 'STRICT-SINGLE-H1',
          code: violation.code,
          violationFingerprint: fingerprint,
          h1Count: violation.metadata?.h1Count ?? null,
          reason: violation.metadata?.reason ?? null,
          decision: 'POPUP_EMITTED',
        })
      }
    } else {
      // ERROR → PASS / SKIP: clear the active violation token (re-arm).
      if (this.strictSingleH1PopupTokens.delete(docKey)) {
        emitRuntimeAudit('DOCUMENT-UTILITY-STRICT-SINGLE-H1-POPUP', {
          documentKey: docKey,
          ruleId: 'STRICT-SINGLE-H1',
          violationFingerprint: null,
          decision: 'VIOLATION_CLEARED',
        })
      }
    }
  }

  private renderDiagnosticsButton(): void {
    const btn = this.diagButtonEl
    if (!btn) return
    const state = deriveDiagnosticsState(this.snapshot)
    btn.textContent = ''
    const label = document.createElement('span')
    if (state.state === 'NO_ACTIVE_DOCUMENT' || state.state === 'EMPTY_DOCUMENT') {
      label.textContent = '文档检测'
      btn.classList.remove('has-issues', 'has-warnings', 'is-healthy')
    } else if (state.state === 'HEALTHY') {
      label.textContent = '✓ 文档检测'
      btn.classList.add('is-healthy')
      btn.classList.remove('has-issues', 'has-warnings')
    } else if (state.errorCount === 0) {
      label.textContent = `⚠ ${state.warningCount}`
      btn.classList.add('has-warnings')
      btn.classList.remove('has-issues', 'is-healthy')
    } else {
      label.textContent = `✕ ${state.errorCount}  ⚠ ${state.warningCount}`
      btn.classList.add('has-issues')
      btn.classList.remove('has-warnings', 'is-healthy')
    }
    btn.appendChild(label)
  }

  private toggleLock(): void {
    if (!this.opts.ctx.authority.getDocumentKey()) {
      this.showToast('无活动文档，无法锁定')
      return
    }
    const nextLocked = !this.editGuard.isLocked()
    if (nextLocked) {
      const ok = this.editGuard.lock()
      if (!ok) {
        this.showToast('无法锁定当前文档')
        return
      }
      this.setLockState(true)
      this.showToast('当前文档已锁定')
    } else {
      this.editGuard.unlock()
      this.setLockState(false)
      this.showToast('已解锁')
    }
    this.renderLockButton()
    this.emitFullBcr('lock-transition')
    emitRuntimeAudit('DOCUMENT-UTILITY-EDIT-GUARD', {
      action: nextLocked ? 'LOCK' : 'UNLOCK',
      state: nextLocked ? 'LOCKED' : 'EDITABLE',
    })
  }

  private setLockState(locked: boolean): void {
    const key = this.opts.ctx.authority.getDocumentKey()
    if (key != null) this.lockState.set(key, locked)
  }

  private renderLockButton(): void {
    const btn = this.lockButtonEl
    if (!btn) return
    const key = this.opts.ctx.authority.getDocumentKey()
    const locked = key != null && (this.lockState.get(key) ?? false)
    btn.textContent = locked ? '已锁定' : '编辑'
    btn.classList.toggle('is-locked', locked)
    if (locked && !this.editGuard.isLocked()) {
      // Re-assert the guard when the button state says locked (e.g. switch back).
      this.editGuard.lock()
    }
  }

  private lockState = new Map<string, boolean>()

  // ── Navigator ───────────────────────────────────────
  private buildNavigator(root: HTMLDivElement): HTMLDivElement {
    const nav = document.createElement('div')
    nav.className = 'inkchapter-doc-navigator'
    nav.setAttribute(UTILITY_UI_ROOT_ATTR, UTILITY_UI_ROOT_VALUE)
    nav.style.position = 'absolute'
    nav.style.pointerEvents = 'auto'

    const topBtn = document.createElement('button')
    topBtn.type = 'button'
    topBtn.className = 'inkchapter-doc-navigator__btn'
    topBtn.setAttribute(UTILITY_UI_ROOT_ATTR, UTILITY_UI_ROOT_VALUE)
    topBtn.setAttribute('aria-label', '回到文档顶部')
    topBtn.title = '回到文档顶部'
    topBtn.textContent = '↑'
    topBtn.disabled = true
    topBtn.addEventListener('click', () => this.handleScrollAction('GO_TOP'))
    this.topBtnEl = topBtn
    nav.appendChild(topBtn)

    const bottomBtn = document.createElement('button')
    bottomBtn.type = 'button'
    bottomBtn.className = 'inkchapter-doc-navigator__btn'
    bottomBtn.setAttribute(UTILITY_UI_ROOT_ATTR, UTILITY_UI_ROOT_VALUE)
    bottomBtn.setAttribute('aria-label', '到达文档底部')
    bottomBtn.title = '到达文档底部'
    bottomBtn.textContent = '↓'
    bottomBtn.disabled = true
    bottomBtn.addEventListener('click', () => this.handleScrollAction('GO_BOTTOM'))
    this.bottomBtnEl = bottomBtn
    nav.appendChild(bottomBtn)

    root.appendChild(nav)
    return nav
  }

  private renderNavState(state: ScrollNavigatorState): void {
    if (this.topBtnEl) this.topBtnEl.disabled = state.atTop
    if (this.bottomBtnEl) this.bottomBtnEl.disabled = state.atBottom
    const key = `${state.atTop}|${state.atBottom}|${state.scrollable}`
    if (key !== this.prevNavStateKey) {
      this.prevNavStateKey = key
      // Phase 7R.3.11.7 §34: a plain scroll-nav-transition never emits the full
      // BCR (geometry/visibility audits already cover the write). Only a
      // placement FAILURE gets the full BCR (authority preserved).
      if (this.computePlacementFailure() !== null) {
        this.emitFullBcr('scroll-nav-transition')
      }
    }
  }

  /**
   * Phase 7R.3.11.8-B — scroll navigator action entry (↑/↓ buttons and
   * diagnostic locate). NO fixed-250ms PASS/FAIL authority: a finite
   * event-driven ScrollOperation settles on scrollend / quiescence, verifies
   * the FINAL live target, and performs at most ONE corrective recovery.
   */
  private handleScrollAction(action: 'GO_TOP' | 'GO_BOTTOM', source: ScrollOperationSource = 'BUTTON'): void {
    const container = getActiveEditorScrollContainer()
    if (!container) return
    const documentKey = this.opts.ctx.authority.getDocumentKey()
    const max = Math.max(0, container.scrollHeight - container.clientHeight)
    const already = action === 'GO_TOP'
      ? container.scrollTop <= SCROLL_OP_EPSILON_PX
      : Math.abs(container.scrollTop - max) <= SCROLL_OP_EPSILON_PX
    if (already) {
      // No operation needed — emit an honest PASS (ALREADY_AT_TARGET).
      this.emitScrollOperationFinal({
        operationId: ++this.scrollNavOperationSeq,
        documentKey,
        action,
        source,
        container,
        startTs: performance.now(),
        settleReason: 'QUIESCENCE',
        scrollTopStart: container.scrollTop,
        maxScrollTopStart: max,
        targetAtStart: action === 'GO_TOP' ? 0 : max,
        scrollEventCount: 0,
        firstScrollEventTs: null,
        lastScrollEventTs: null,
        scrollTopLastObserved: container.scrollTop,
        maxScrollTopLastObserved: max,
        reversalCount: 0,
        scrollTopAtLegacyCheck: null,
        legacyWouldPass: true,
        recoveryAttemptCount: 0,
        drawerVisibleAtStart: this.drawerOpen,
        lockedAtStart: this.editGuard.isLocked(),
        decision: 'PASS',
        targetReached: true,
        reasonDetail: 'ALREADY_AT_TARGET',
      })
      return
    }
    this.beginScrollOperation(action, container, source)
  }

  /** Begin ONE finite event-driven scroll operation. */
  private beginScrollOperation(action: 'GO_TOP' | 'GO_BOTTOM', container: HTMLElement, source: ScrollOperationSource): void {
    // A new click supersedes any in-flight operation (release listeners/timers).
    this.cancelScrollOperation('SUPERSEDED')
    const operationId = ++this.scrollNavOperationSeq
    const scrollTopStart = container.scrollTop
    const maxScrollTopStart = Math.max(0, container.scrollHeight - container.clientHeight)
    const op: ActiveScrollOperation = {
      operationId,
      documentKey: this.opts.ctx.authority.getDocumentKey(),
      action,
      source,
      container,
      startTs: performance.now(),
      scrollTopStart,
      maxScrollTopStart,
      targetAtStart: action === 'GO_TOP' ? 0 : maxScrollTopStart,
      scrollEventCount: 0,
      firstScrollEventTs: null,
      lastScrollEventTs: null,
      scrollTopLastObserved: scrollTopStart,
      maxScrollTopLastObserved: maxScrollTopStart,
      reversalCount: 0,
      scrollTopAtLegacyCheck: null,
      legacyWouldPass: null,
      recoveryAttemptCount: 0,
      drawerVisibleAtStart: this.drawerOpen,
      lockedAtStart: this.editGuard.isLocked(),
      settleTimer: null,
      safetyDeadline: null,
      legacySampleTimer: null,
      onScroll: () => this.onScrollOperationEvent(op),
      onScrollEnd: null,
    }
    const scrollendSupported = typeof container.addEventListener === 'function' && 'onscrollend' in container
    if (scrollendSupported) {
      op.onScrollEnd = () => this.onScrollOperationSettle(op, 'SCROLLEND')
      container.addEventListener('scrollend', op.onScrollEnd, { passive: true } as AddEventListenerOptions)
    }
    container.addEventListener('scroll', op.onScroll, { passive: true })
    // Legacy 250ms forensic SAMPLE ONLY (authority=false, never decides PASS/FAIL).
    op.legacySampleTimer = setTimeout(() => {
      const t = container.scrollTop
      op.scrollTopAtLegacyCheck = t
      const maxNow = Math.max(0, container.scrollHeight - container.clientHeight)
      op.legacyWouldPass = action === 'GO_TOP' ? t <= 2 : maxNow <= 2 || t >= maxNow - 2
    }, 250)
    op.safetyDeadline = setTimeout(() => this.onScrollOperationSettle(op, 'SAFETY_TIMEOUT'), SCROLL_OP_SAFETY_DEADLINE_MS)
    this.activeScrollOperation = op
    if (action === 'GO_TOP') this.scrollNav?.scrollToTop()
    else this.scrollNav?.scrollToBottom()
  }

  /** Scroll event handler — memory-only sampling + quiescence debounce. */
  private onScrollOperationEvent(op: ActiveScrollOperation): void {
    const t = op.container.scrollTop
    const max = Math.max(0, op.container.scrollHeight - op.container.clientHeight)
    if (op.scrollEventCount > 0) {
      const movingTowardBottom = t > op.scrollTopLastObserved
      if ((op.action === 'GO_BOTTOM' && !movingTowardBottom && t < op.scrollTopLastObserved - 1)
        || (op.action === 'GO_TOP' && movingTowardBottom && t > op.scrollTopLastObserved + 1)) {
        op.reversalCount++
      }
    }
    op.scrollEventCount++
    if (op.firstScrollEventTs === null) op.firstScrollEventTs = performance.now()
    op.lastScrollEventTs = performance.now()
    op.scrollTopLastObserved = t
    op.maxScrollTopLastObserved = max
    if (this.activeScrollOperation === op) {
      if (op.settleTimer) clearTimeout(op.settleTimer)
      op.settleTimer = setTimeout(() => this.onScrollOperationSettle(op, 'QUIESCENCE'), SCROLL_OP_QUIESCENCE_MS)
    }
  }

  /** Settle authority: scrollend / quiescence / safety deadline. */
  private onScrollOperationSettle(op: ActiveScrollOperation, settleReason: ScrollOperationSettleReason): void {
    if (this.activeScrollOperation !== op) return
    if (!op.container.isConnected) {
      this.finalizeScrollOperation(op, settleReason, 'FAIL_CONTAINER_DISCONNECTED')
      return
    }
    const maxNow = Math.max(0, op.container.scrollHeight - op.container.clientHeight)
    const topNow = op.container.scrollTop
    const reached = op.action === 'GO_TOP'
      ? topNow <= SCROLL_OP_EPSILON_PX
      : Math.abs(topNow - maxNow) <= SCROLL_OP_EPSILON_PX
    if (reached) {
      const decision = settleReason === 'SAFETY_TIMEOUT' ? 'PASS_TARGET_REACHED_AT_DEADLINE'
        : op.recoveryAttemptCount > 0 ? 'PASS_RECOVERED'
        : 'PASS'
      this.finalizeScrollOperation(op, settleReason, decision)
      return
    }
    // Genuine early stop → at most ONE corrective recovery (behavior='auto').
    if (settleReason !== 'SAFETY_TIMEOUT' && op.recoveryAttemptCount < SCROLL_OP_MAX_RECOVERY_ATTEMPTS) {
      op.recoveryAttemptCount++
      emitRuntimeAudit('DOCUMENT-UTILITY-SCROLL-RECOVERY', {
        operationId: op.operationId,
        documentKey: op.documentKey,
        action: op.action,
        source: op.source,
        attempt: op.recoveryAttemptCount,
        scrollTopBefore: topNow,
        maxScrollTop: maxNow,
        decision: 'CORRECTIVE_AUTO_SCROLL',
      })
      op.container.scrollTo({ top: op.action === 'GO_TOP' ? 0 : maxNow, behavior: 'auto' })
      // Re-arm quiescence (safety deadline already running).
      if (op.settleTimer) clearTimeout(op.settleTimer)
      op.settleTimer = setTimeout(() => this.onScrollOperationSettle(op, 'QUIESCENCE'), SCROLL_OP_QUIESCENCE_MS)
      return
    }
    const decision = settleReason === 'SAFETY_TIMEOUT' ? 'TIMEOUT_BEFORE_SETTLE' : 'FAIL_SETTLED_BEFORE_TARGET'
    this.finalizeScrollOperation(op, settleReason, decision)
  }

  /** Cancel the active operation (document switch / dispose / superseded). */
  private cancelScrollOperation(decision: 'CANCELLED_DOCUMENT_SWITCH' | 'SUPERSEDED'): void {
    const op = this.activeScrollOperation
    if (!op) return
    this.finalizeScrollOperation(op, 'QUIESCENCE', decision)
  }

  /** Finalize: release resources + emit the SINGLE business authority log. */
  private finalizeScrollOperation(
    op: ActiveScrollOperation,
    settleReason: ScrollOperationSettleReason,
    decision: ScrollOperationDecision,
  ): void {
    if (this.activeScrollOperation !== op) return
    this.activeScrollOperation = null
    op.container.removeEventListener('scroll', op.onScroll)
    if (op.onScrollEnd) op.container.removeEventListener('scrollend', op.onScrollEnd)
    if (op.settleTimer) clearTimeout(op.settleTimer)
    if (op.safetyDeadline) clearTimeout(op.safetyDeadline)
    if (op.legacySampleTimer) clearTimeout(op.legacySampleTimer)
    const finalTop = op.container.scrollTop
    const finalMax = Math.max(0, op.container.scrollHeight - op.container.clientHeight)
    const targetReached = decision === 'PASS' || decision === 'PASS_RECOVERED' || decision === 'PASS_TARGET_REACHED_AT_DEADLINE'
    this.emitScrollOperationFinal({
      operationId: op.operationId,
      documentKey: op.documentKey,
      action: op.action,
      source: op.source,
      container: op.container,
      startTs: op.startTs,
      settleReason,
      scrollTopStart: op.scrollTopStart,
      maxScrollTopStart: op.maxScrollTopStart,
      targetAtStart: op.targetAtStart,
      scrollEventCount: op.scrollEventCount,
      firstScrollEventTs: op.firstScrollEventTs,
      lastScrollEventTs: op.lastScrollEventTs,
      scrollTopLastObserved: op.scrollTopLastObserved,
      maxScrollTopLastObserved: op.maxScrollTopLastObserved,
      reversalCount: op.reversalCount,
      scrollTopAtLegacyCheck: op.scrollTopAtLegacyCheck,
      legacyWouldPass: op.legacyWouldPass,
      recoveryAttemptCount: op.recoveryAttemptCount,
      drawerVisibleAtStart: op.drawerVisibleAtStart,
      lockedAtStart: op.lockedAtStart,
      decision,
      targetReached,
      reasonDetail: undefined,
      finalTop,
      finalMax,
    })
  }

  private emitScrollOperationFinal(input: {
    operationId: number
    documentKey: string | null
    action: 'GO_TOP' | 'GO_BOTTOM'
    source: ScrollOperationSource
    container: HTMLElement
    startTs: number
    settleReason: ScrollOperationSettleReason
    scrollTopStart: number
    maxScrollTopStart: number
    targetAtStart: number
    scrollEventCount: number
    firstScrollEventTs: number | null
    lastScrollEventTs: number | null
    scrollTopLastObserved: number
    maxScrollTopLastObserved: number
    reversalCount: number
    scrollTopAtLegacyCheck: number | null
    legacyWouldPass: boolean | null
    recoveryAttemptCount: number
    drawerVisibleAtStart: boolean
    lockedAtStart: boolean
    decision: ScrollOperationDecision
    targetReached: boolean
    reasonDetail?: string
    finalTop?: number
    finalMax?: number
  }): void {
    this.scrollOperationEmitCount++
    const finalTop = input.finalTop ?? input.container.scrollTop
    const finalMax = input.finalMax ?? Math.max(0, input.container.scrollHeight - input.container.clientHeight)
    emitRuntimeAudit('DOCUMENT-UTILITY-SCROLL-OPERATION', {
      operationId: input.operationId,
      documentKey: input.documentKey,
      source: input.source,
      action: input.action,
      containerIdentity: `${input.container.tagName}#${input.container.id || ''}.${String(input.container.className || '').slice(0, 40)}`,
      scrollTopStart: input.scrollTopStart,
      maxScrollTopStart: input.maxScrollTopStart,
      targetAtStart: input.targetAtStart,
      scrollEventCount: input.scrollEventCount,
      firstScrollEventTs: input.firstScrollEventTs,
      lastScrollEventTs: input.lastScrollEventTs,
      settleReason: input.settleReason,
      scrollTopFinal: finalTop,
      maxScrollTopFinal: finalMax,
      finalTarget: input.action === 'GO_TOP' ? 0 : finalMax,
      targetReached: input.targetReached,
      recoveryAttemptCount: input.recoveryAttemptCount,
      targetTolerancePx: SCROLL_OP_EPSILON_PX,
      drawerVisible: input.drawerVisibleAtStart,
      locked: input.lockedAtStart,
      reversalCount: input.reversalCount,
      // Legacy 250ms forensic sample — authority=false, never a decision.
      legacySampleOnly: true,
      scrollTopAtLegacyCheck: input.scrollTopAtLegacyCheck,
      legacyWouldPass: input.legacyWouldPass,
      elapsedMs: performance.now() - input.startTs,
      reason: input.reasonDetail ?? null,
      decision: input.decision,
    })
  }

  /** Phase 7R.3.11.8-B — active operation/listener/timer counts (cleanup gate). */
  getScrollOperationCounters(): {
    activeOperationCount: number
    activeScrollListenerCount: number
    activeScrollendListenerCount: number
    activeSettleTimerCount: number
    activeSafetyDeadlineCount: number
    operationEmitCount: number
  } {
    const op = this.activeScrollOperation
    return {
      activeOperationCount: op ? 1 : 0,
      activeScrollListenerCount: op ? 1 : 0,
      activeScrollendListenerCount: op && op.onScrollEnd ? 1 : 0,
      activeSettleTimerCount: op && op.settleTimer ? 1 : 0,
      activeSafetyDeadlineCount: op && op.safetyDeadline ? 1 : 0,
      operationEmitCount: this.scrollOperationEmitCount,
    }
  }

  /** Phase 7R.3.11.8-B — STRICT-SINGLE-H1 popup emission count (dedup gate). */
  getStrictSingleH1PopupCount(): number {
    return this.strictSingleH1PopupEmitCount
  }

  // ── Drawer ──────────────────────────────────────────
  private buildDrawer(root: HTMLDivElement): HTMLDivElement {
    const drawer = document.createElement('div')
    drawer.className = 'inkchapter-doc-drawer'
    drawer.setAttribute(UTILITY_UI_ROOT_ATTR, UTILITY_UI_ROOT_VALUE)
    drawer.style.position = 'absolute'
    drawer.style.display = 'none'
    drawer.style.pointerEvents = 'auto'

    const header = document.createElement('div')
    header.className = 'inkchapter-doc-drawer__header'
    const title = document.createElement('div')
    title.className = 'inkchapter-doc-drawer__title'
    title.textContent = '文档检测'
    header.appendChild(title)

    const counts = document.createElement('div')
    counts.className = 'inkchapter-doc-drawer__counts'
    this.drawerCountsEl = counts
    header.appendChild(counts)

    const actions = document.createElement('div')
    actions.className = 'inkchapter-doc-drawer__actions'
    const recheck = document.createElement('button')
    recheck.type = 'button'
    recheck.className = 'inkchapter-doc-drawer__action'
    recheck.setAttribute(UTILITY_UI_ROOT_ATTR, UTILITY_UI_ROOT_VALUE)
    recheck.textContent = '重新检查'
    recheck.addEventListener('click', () => this.diagnostics.recompute())
    const close = document.createElement('button')
    close.type = 'button'
    close.className = 'inkchapter-doc-drawer__action'
    close.setAttribute(UTILITY_UI_ROOT_ATTR, UTILITY_UI_ROOT_VALUE)
    close.textContent = '关闭'
    close.addEventListener('click', () => this.closeDrawer())
    actions.appendChild(recheck)
    actions.appendChild(close)
    header.appendChild(actions)
    drawer.appendChild(header)

    const list = document.createElement('div')
    list.className = 'inkchapter-doc-drawer__list'
    this.drawerListEl = list
    drawer.appendChild(list)

    root.appendChild(drawer)
    return drawer
  }

  private drawerCountsEl: HTMLDivElement | null = null

  private renderDrawer(): void {
    if (!this.drawerEl || !this.drawerListEl || !this.drawerCountsEl) return
    const snapshot = this.snapshot
    const activeKey = this.opts.ctx.authority.getDocumentKey()
    this.drawerCountsEl.textContent = ''
    if (!snapshot || snapshot.documentKey == null || snapshot.documentKey !== activeKey) {
      // Phase 7R.3.11.4 — never render stale items: show a pending placeholder.
      const pending = document.createElement('div')
      pending.className = 'inkchapter-doc-drawer__item--empty'
      pending.textContent = snapshot && snapshot.documentKey !== activeKey ? '正在刷新当前文档…' : '没有活动文档'
      this.drawerListEl.replaceChildren(pending)
      emitRuntimeAudit('DOCUMENT-UTILITY-DIAGNOSTIC-SNAPSHOT', {
        action: 'DRAWER_RENDERED',
        documentKey: snapshot?.documentKey ?? null,
        activeDocumentKey: activeKey,
        revision: snapshot?.revision ?? null,
        sourceRevision: snapshot?.sourceRevision ?? null,
        itemCount: 0,
        decision: 'DRAWER_RENDER_BLOCKED_STALE_SNAPSHOT',
      })
      // Phase 7R.3.11.8B.3.1 — read-only layout audit follows every re-render.
      this.scheduleDrawerContentAudit()
      return
    }
    const label = document.createElement('span')
    label.textContent = `错误 ${snapshot.errorCount}   警告 ${snapshot.warningCount}   提示 ${snapshot.infoCount}`
    this.drawerCountsEl.appendChild(label)

    this.drawerListEl.replaceChildren()
    if (snapshot.diagnostics.length === 0) {
      const ok = document.createElement('div')
      ok.className = 'inkchapter-doc-drawer__item--empty'
      ok.textContent = '未发现问题'
      this.drawerListEl.appendChild(ok)
    } else {
      for (const d of snapshot.diagnostics) {
        this.drawerListEl.appendChild(this.buildDrawerItem(d))
      }
    }
    emitRuntimeAudit('DOCUMENT-UTILITY-DIAGNOSTIC-SNAPSHOT', {
      action: 'DRAWER_RENDERED',
      documentKey: snapshot.documentKey,
      activeDocumentKey: activeKey,
      revision: snapshot.revision,
      sourceRevision: snapshot.sourceRevision,
      drawerVisible: this.drawerOpen,
      itemCount: snapshot.diagnostics.length,
      errorCount: snapshot.errorCount,
      warningCount: snapshot.warningCount,
      hintCount: snapshot.infoCount,
      snapshotMatchesActiveDocument: snapshot.documentKey === activeKey,
      decision: 'DRAWER_RENDERED_MATCHES_ACTIVE',
    })
    // Phase 7R.3.11.8B.3.1 — read-only layout audit follows every re-render
    // (rAF + DOM read only; geometryWriteDelta stays 0 by construction).
    this.scheduleDrawerContentAudit()
  }

  /**
   * Phase 7R.3.11.8B.5 — UNIVERSAL locate action. Every drawer 定位 button
   * routes here (single authority — never per-item scrollIntoView/querySelector).
   * Flow: latest snapshot → diagnosticId present → documentKey match →
   * resolveDiagnosticLocation → scroll (element or GO_TOP/GO_BOTTOM) →
   * temporary highlight → locate audit. Bounded stale recovery: at most ONE
   * diagnostics refresh. Read-only: never edits Markdown, never bypasses the
   * edit guard into a write.
   */
  private locateDiagnostic(diagnosticId: string): void {
    const snapshot = this.diagnostics.getSnapshot()
    let diag = snapshot?.diagnostics.find(d => d.id === diagnosticId) ?? null
    let refreshed = false
    if (!diag) {
      this.diagnostics.recompute()
      refreshed = true
      diag = this.diagnostics.getSnapshot()?.diagnostics.find(d => d.id === diagnosticId) ?? null
      if (!diag) {
        this.showToast('该问题已修复，请重新检查')
        this.emitLocateAudit(diagnosticId, null, 'NOT_FOUND', 'DIAGNOSTIC_GONE_AFTER_BOUNDED_REFRESH', 0)
        return
      }
    }
    const currentKey = this.opts.ctx.authority.getDocumentKey()
    if (diag.documentKey && currentKey && diag.documentKey !== currentKey) {
      if (!refreshed) {
        this.diagnostics.recompute()
        diag = this.diagnostics.getSnapshot()?.diagnostics.find(d => d.id === diagnosticId) ?? null
      }
      if (!diag || (diag.documentKey && currentKey && diag.documentKey !== currentKey)) {
        this.showToast('文档已切换，已刷新诊断')
        this.emitLocateAudit(diagnosticId, diag, 'WRONG_DOCUMENT', 'DIAGNOSTIC_BELONGS_TO_ANOTHER_DOCUMENT', 0)
        return
      }
    }

    // Multi-target cycle: advance the per-diagnostic cursor.
    let targetIndex = 0
    if (diag.location?.kind === 'multi-target' && diag.location.targets.length > 0) {
      targetIndex = (this.multiTargetCursor.get(diagnosticId) ?? 0) % diag.location.targets.length
      this.multiTargetCursor.set(diagnosticId, targetIndex + 1)
    }

    const resolveCtx: DiagnosticLocationResolveContext = {
      documentKey: currentKey,
      getRoot: () => resolveBusinessContentRoot(),
      resolveHeadingIdentity: (id) => this.resolveHeadingIdentity(id),
      resolveSourceLine: (line) => this.resolveSourceLine(line),
      resolveBlockIdentity: (kind, stableId) => this.resolveBlockIdentity(kind, stableId),
    }
    const result = resolveDiagnosticLocation(diag, diag.location, resolveCtx, targetIndex)

    if (result.decision === 'RESOLVED') {
      if (result.scrollAction) {
        // Document-boundary locate reuses the ONE Scroll Operation authority.
        this.handleScrollAction(result.scrollAction, 'DIAGNOSTIC_LOCATE')
        this.emitLocateAudit(diagnosticId, diag, 'RESOLVED', 'SCROLL_ACTION', targetIndex)
        return
      }
      if (result.element) {
        const lr = this.locator.locate(result.element)
        this.emitLocateAudit(diagnosticId, diag, 'RESOLVED', lr.located ? 'SCROLLED' : 'NO_TARGET', targetIndex)
        if (!lr.located) this.showToast('目标已变化，请重新检查')
        return
      }
    }
    this.emitLocateAudit(diagnosticId, diag, result.decision, result.reason ?? 'UNRESOLVED', targetIndex)
    this.showToast('目标已变化，请重新检查')
  }

  /** stableIdentity → live heading element (re-derived from the CURRENT frame). */
  private resolveHeadingIdentity(stableIdentity: string): HTMLElement | null {
    const root = resolveBusinessContentRoot()
    if (!root) return null
    for (const el of Array.from(root.querySelectorAll<HTMLElement>('h1,h2,h3,h4,h5,h6'))) {
      try {
        if (this.opts.providers.getHeadingIdentity(el) === stableIdentity) return el
      } catch { /* keep scanning */ }
    }
    return null
  }

  /** 0-based source line → live element carrying Typora `data-line`. */
  private resolveSourceLine(line: number): HTMLElement | null {
    const root = resolveBusinessContentRoot()
    if (!root) return null
    return root.querySelector<HTMLElement>(`[data-line="${line}"]`)
  }

  /** block kind + `block:<kind>:<ordinal>` (or `local:<target>` for links) → live element. */
  private resolveBlockIdentity(
    blockKind: 'figure' | 'table' | 'code' | 'formula' | 'link',
    stableIdentity: string,
  ): HTMLElement | null {
    const root = resolveBusinessContentRoot()
    if (!root) return null
    if (blockKind === 'link') {
      const target = stableIdentity.replace(/^local:/, '')
      if (!target) return null
      for (const a of Array.from(root.querySelectorAll<HTMLAnchorElement>('a[href]'))) {
        if (a.getAttribute('href') === target) return a
      }
      return null
    }
    const m = /^block:(\w+):(\d+)$/.exec(stableIdentity)
    if (!m) return null
    const ordinal = Number.parseInt(m[2], 10)
    const selector = blockKind === 'figure' ? 'img'
      : blockKind === 'table' ? 'table'
        : blockKind === 'code' ? 'pre.md-fences'
          : '.md-math-block'
    return Array.from(root.querySelectorAll<HTMLElement>(selector))[ordinal] ?? null
  }

  /** Phase 7R.3.11.8B.5 — DOCUMENT-DIAGNOSTIC-LOCATE-AUDIT (one record per locate). */
  private emitLocateAudit(
    diagnosticId: string,
    diag: DocumentDiagnosticsSnapshot['diagnostics'][number] | null,
    resolveDecision: string,
    reason: string,
    targetIndex: number,
  ): void {
    emitRuntimeAudit('DOCUMENT-DIAGNOSTIC-LOCATE-AUDIT', {
      documentKey: diag?.documentKey ?? this.opts.ctx.authority.getDocumentKey(),
      diagnosticId,
      ruleId: diag ? (getRuleMeta(diag.code)?.ruleId ?? diag.code) : null,
      severity: diag?.severity ?? null,
      locationKind: diag?.location?.kind ?? null,
      targetCount: diag?.location?.kind === 'multi-target' ? diag.location.targets.length : 1,
      targetIndex,
      resolveDecision,
      scrollDecision: resolveDecision === 'RESOLVED' ? (reason === 'SCROLLED' || reason === 'SCROLL_ACTION' ? 'PASS' : 'N/A') : 'N/A',
      highlightDecision: resolveDecision === 'RESOLVED' && reason === 'SCROLLED' ? 'PASS' : 'N/A',
      decision: resolveDecision === 'RESOLVED' ? 'PASS' : 'FAIL',
      reason,
    })
  }

  private buildDrawerItem(d: DocumentDiagnosticsSnapshot['diagnostics'][number]): HTMLElement {
    const item = document.createElement('div')
    item.className = `inkchapter-doc-drawer__item inkchapter-doc-drawer__item--${d.severity}`
    item.setAttribute(UTILITY_UI_ROOT_ATTR, UTILITY_UI_ROOT_VALUE)

    const icon = document.createElement('span')
    icon.className = 'inkchapter-doc-drawer__item-icon'
    icon.textContent = d.severity === 'error' ? '✕' : d.severity === 'warning' ? '⚠' : 'ℹ'
    item.appendChild(icon)

    const body = document.createElement('div')
    body.className = 'inkchapter-doc-drawer__item-body'
    const msg = document.createElement('div')
    msg.className = 'inkchapter-doc-drawer__item-msg'
    msg.textContent = d.message
    body.appendChild(msg)
    if (d.detail) {
      const detail = document.createElement('div')
      detail.className = 'inkchapter-doc-drawer__item-detail'
      detail.textContent = d.detail
      body.appendChild(detail)
    }
    item.appendChild(body)

    // Phase 7R.3.11.8B.5 — EVERY published diagnostic has a location
    // (PUBLISHED = LOCATABLE) → the 定位 button is always present and routes
    // through the ONE universal `locateDiagnostic` action authority.
    const locate = document.createElement('button')
    locate.type = 'button'
    locate.className = 'inkchapter-doc-drawer__item-locate'
    locate.setAttribute(UTILITY_UI_ROOT_ATTR, UTILITY_UI_ROOT_VALUE)
    locate.textContent = '定位'
    locate.addEventListener('click', () => {
      this.locateDiagnostic(d.id)
    })
    item.appendChild(locate)

    return item
  }

  private toggleDrawer(): void {
    if (this.drawerOpen) this.closeDrawer()
    else this.openDrawer()
  }

  /**
   * Phase 7R.3.11.6 — SINGLE Drawer state authority: open and close share this
   * entry so every state change ALWAYS schedules a geometry recompute. Drawer
   * methods never write navigator position directly (single write site).
   */
  private setDrawerOpen(nextOpen: boolean): void {
    if (this.drawerOpen === nextOpen) return
    // Phase 7R.3.11.8B.3 — capture the navigator position BEFORE the toggle so
    // the position-invariant audit can prove deltaX/deltaY <= 1px.
    const navRectBefore = this.latestRects.navigator
    this.navRectBeforeDrawerToggle = navRectBefore ? { right: navRectBefore.right, bottom: navRectBefore.bottom } : null
    this.drawerOpen = nextOpen
    if (this.drawerEl) {
      this.drawerEl.style.display = nextOpen ? 'flex' : 'none'
    }
    this.scheduleGeometrySync(nextOpen ? 'drawer-open' : 'drawer-close')
  }

  private openDrawer(): void {
    if (!this.drawerEl) return
    this.setDrawerOpen(true)
    this.renderDrawer()
    emitRuntimeAudit('DOCUMENT-UTILITY-DRAWER', {
      action: 'OPEN',
      diagnosticCount: this.snapshot?.diagnostics.length ?? 0,
      errorCount: this.snapshot?.errorCount ?? 0,
      warningCount: this.snapshot?.warningCount ?? 0,
    })
  }

  private closeDrawer(): void {
    if (!this.drawerEl) return
    this.setDrawerOpen(false)
    emitRuntimeAudit('DOCUMENT-UTILITY-DRAWER', {
      action: 'CLOSE',
      diagnosticCount: 0,
    })
  }

  // ── Toast (subtle, transient) ───────────────────────
  private toastEl: HTMLDivElement | null = null
  private toastTimer: ReturnType<typeof setTimeout> | null = null

  private showToast(message: string): void {
    if (!this.root) return
    if (!this.toastEl) {
      this.toastEl = document.createElement('div')
      this.toastEl.className = 'inkchapter-doc-toast'
      this.toastEl.setAttribute(UTILITY_UI_ROOT_ATTR, UTILITY_UI_ROOT_VALUE)
      this.toastEl.style.position = 'fixed'
      this.toastEl.style.pointerEvents = 'none'
      this.root.appendChild(this.toastEl)
    }
    this.toastEl.textContent = message
    this.toastEl.style.opacity = '1'
    if (this.toastTimer) clearTimeout(this.toastTimer)
    this.toastTimer = setTimeout(() => {
      if (this.toastEl) this.toastEl.style.opacity = '0'
      this.toastTimer = null
    }, prefersReducedMotion() ? 1200 : 1800)
  }
}
