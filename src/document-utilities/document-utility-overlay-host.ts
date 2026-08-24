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
}

const TOOLBAR_TOP_PX = 12
const TOOLBAR_RIGHT_PX = 24
const NAV_RIGHT_PX = 28
const NAV_BOTTOM_PX = 64
const DRAWER_TOP_PX = 56
const DRAWER_RIGHT_PX = 12
const DRAWER_BOTTOM_PX = 16

export interface OverlayGeometry {
  toolbarTop: number
  toolbarRight: number
  navRight: number
  navBottom: number
  drawerTop: number
  drawerRight: number
  drawerBottom: number
}

export interface OverlayGeometryOptions {
  drawerOpen: boolean
}

const DRAWER_WIDTH_PX = 360
/** Drawer↔navigator horizontal gap when the drawer is open (>= 12px). */
const DRAWER_NAV_GAP_PX = 16

/** Phase 7R.3.11.4 — ResizeObserver attribution windows (single source of truth). */
const EXTERNAL_RESIZE_WINDOW_MS = 100
const UTILITY_WRITE_WINDOW_MS = 100

/** Phase 7R.3.11.6 — navigator placement tolerance (px) for NAV-PLACEMENT gate. */
const NAV_PLACEMENT_TOLERANCE_PX = 3

/** Phase 7R.3.11.8 — scroll-nav operation forensic constants. */
const SCROLL_NAV_TARGET_TOLERANCE_PX = 2
/** Scroll-event quiescence window: the operation finalizes when no scroll
 *  event arrives for this window (NOT a fixed click-to-success delay). */
const SCROLL_NAV_QUIESCENCE_MS = 150
/** Bounded safety deadline — resource leak guard / TIMEOUT classification only. */
const SCROLL_NAV_SAFETY_DEADLINE_MS = 2500

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

/** Phase 7R.3.11.8-A — scroll operation forensic record (observability only). */
export type ScrollNavOperationSettleReason = 'SCROLLEND' | 'QUIESCENCE' | 'SAFETY_TIMEOUT' | 'SUPERSEDED'

export interface ScrollNavOperationForensicRecord {
  operationId: number
  action: 'GO_TOP' | 'GO_BOTTOM'
  source: 'BUTTON'
  documentKey: string | null
  containerTag: string
  containerId: string
  containerClass: string
  containerConnected: boolean
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
  scrollTopFinal: number
  maxScrollTopFinal: number
  targetReached: boolean
  elapsedMs: number
  settleReason: ScrollNavOperationSettleReason
  drawerVisibleAtStart: boolean
  lockedAtStart: boolean
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
 * Phase 7R.3.11.4 — collision-aware geometry. When the drawer is open the
 * navigator shifts LEFT of the drawer (never hidden), keeping
 * intersection(drawer, navigator) = 0 with a >= 12px gap.
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
  const navRight = drawerOpen
    ? right + DRAWER_RIGHT_PX + DRAWER_WIDTH_PX + DRAWER_NAV_GAP_PX
    : right + NAV_RIGHT_PX
  return {
    toolbarTop: top + TOOLBAR_TOP_PX,
    toolbarRight: right + TOOLBAR_RIGHT_PX,
    navRight,
    navBottom: bottomGap + NAV_BOTTOM_PX,
    drawerTop: top + DRAWER_TOP_PX,
    drawerRight: right + DRAWER_RIGHT_PX,
    drawerBottom: bottomGap + DRAWER_BOTTOM_PX,
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
  | 'FAIL_ACCIDENTAL_FULLSCREEN_CHILD'
  | 'NAVIGATOR_STALE_DRAWER_OFFSET'
  | 'NAVIGATOR_NOT_AT_AVOIDANCE_POSITION'

export type NavigatorPlacementFailure = 'NAVIGATOR_STALE_DRAWER_OFFSET' | 'NAVIGATOR_NOT_AT_AVOIDANCE_POSITION'

/**
 * Phase 7R.3.11.6 — navigator placement evaluation (pure, single formula).
 * expectedRight comes from the SAME computeOverlayGeometry authority; the audit
 * and BCR verdict never duplicate a second business formula.
 */
export function evaluateNavigatorPlacement(opts: {
  drawerOpen: boolean
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
  decision: 'PASS' | NavigatorPlacementFailure
} {
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
  let decision: 'PASS' | NavigatorPlacementFailure = 'PASS'
  if (rightDelta > opts.tolerancePx) {
    decision = opts.drawerOpen ? 'NAVIGATOR_NOT_AT_AVOIDANCE_POSITION' : 'NAVIGATOR_STALE_DRAWER_OFFSET'
  }
  return { expectedRight, actualRight, rightDelta, intersectionArea: 0, gapPx, decision }
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
  toolbarFullscreen: boolean
  navigatorFullscreen: boolean
  drawerFullscreen: boolean
  stateSpecificPlacementValid: boolean
  placementFailure: NavigatorPlacementFailure | null
}): BcrVerdict {
  if (opts.toolbarFullscreen || opts.navigatorFullscreen || opts.drawerFullscreen) return 'FAIL_ACCIDENTAL_FULLSCREEN_CHILD'
  if (!opts.geometryCommitted) return 'GEOMETRY_PENDING'
  if (!opts.toolbarInsideEditorShell || !opts.navigatorInsideEditorShell) return 'GEOMETRY_PENDING'
  if (!opts.toolbarVisible || !opts.navigatorVisible) return 'GEOMETRY_PENDING'
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
  private lastRoSawChangedShell = false
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
  /** Phase 7R.3.11.8-A — active scroll operation forensic handle (observability). */
  private scrollNavOperationSeq = 0
  private scrollOpForensic: {
    record: ScrollNavOperationForensicRecord
    container: HTMLElement
    settleTimer: ReturnType<typeof setTimeout> | null
    safetyDeadline: ReturnType<typeof setTimeout> | null
    onScroll: () => void
  } | null = null
  private snapshot: DocumentDiagnosticsSnapshot | null = null
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
        // Confirmed causal loop: RO callback right after a utility write AND
        // the observed shell geometry changed since that write (only provable
        // when the next utility write arrives without an external resize).
        const shellRectNow = container.getBoundingClientRect()
        const changed = this.lastWriteShellRect != null && Math.abs(shellRectNow.width - this.lastWriteShellRect.width) > 0.5
        if (!externalRecent && utilityWriteRecent && changed) {
          this.lastRoSawChangedShell = true
          this.externalEpochAtLoopStart = this.externalResizeEpoch
        } else if (externalRecent) {
          this.lastRoSawChangedShell = false
        }
        this.scheduleGeometrySync('resize-observer')
      })
      this.resizeObserver.observe(container)
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
          snapshotMatchesActiveDocument: snapshot.documentKey === activeKey,
          decision: snapshot.documentKey === activeKey ? 'PUBLISHED_MATCHES_ACTIVE' : 'PUBLISHED_MISMATCH',
        })
      }
    }))

    // Initial recompute (event-driven — the caller controls further triggers).
    this.diagnostics.recompute()

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
    // Phase 7R.3.11.8-A: release any in-flight scroll operation forensic.
    this.finalizeScrollOperationForensic('SUPERSEDED')
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
    // Phase 7R.3.11.6 — execution reads the LIVE drawerOpen (never a schedule-time snapshot).
    const next = computeOverlayGeometry(
      rect && rect.width > 0 ? { top: rect.top, right: rect.right, bottom: rect.bottom } : null,
      { width: window.innerWidth, height: window.innerHeight },
      { drawerOpen: this.drawerOpen },
    )
    const hasDrawerTransition = reasons.has('drawer-open') || reasons.has('drawer-close')
    const prev = this.lastGeometry
    this.lastGeometry = next
    if (prev && JSON.stringify(prev) === JSON.stringify(next)) {
      this.geometryCounters.noopCount++
      // State changed but geometry is already correct (e.g. rapid toggle
      // ending where it started): still report the state-specific placement.
      if (hasDrawerTransition) this.emitNavigatorPlacementAudit(this.drawerOpen ? 'drawer-open-committed' : 'drawer-close-committed')
      return
    }
    this.geometryCounters.writeCount++
    this.utilityWriteEpoch++
    this.lastGeometryWriteTs = this.now()
    if (this.toolbarEl) {
      this.toolbarEl.style.top = `${next.toolbarTop}px`
      this.toolbarEl.style.right = `${next.toolbarRight}px`
    }
    if (this.navigatorEl) {
      this.navigatorEl.style.right = `${next.navRight}px`
      this.navigatorEl.style.bottom = `${next.navBottom}px`
    }
    if (this.drawerEl) {
      this.drawerEl.style.top = `${next.drawerTop}px`
      this.drawerEl.style.right = `${next.drawerRight}px`
      this.drawerEl.style.bottom = `${next.drawerBottom}px`
    }
    // Confirmed feedback loop: a previous RO observed a shell change caused by
    // our write and no external resize happened → this write completes the loop.
    if (this.lastRoSawChangedShell && this.externalResizeEpoch === this.externalEpochAtLoopStart) {
      this.geometryCounters.feedbackLoopConfirmedCount++
    }
    this.lastRoSawChangedShell = false
    this.lastWriteShellRect = this.latestRects.shell
    const firstCommit = !this.geometryCommitted
    this.geometryCommitted = true
    // In-memory rects stay fresh during bursts; full BCR is milestone-only.
    this.refreshLatestRects()
    this.emitGeometryAndVisibility([...reasons].join(','), next)
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
    const placementFailure = this.computePlacementFailure()
    const decision = computeBcrVerdict({
      geometryCommitted: committed,
      toolbarInsideEditorShell: toolbarInside,
      navigatorInsideEditorShell: navigatorInside,
      toolbarVisible,
      navigatorVisible,
      toolbarFullscreen,
      navigatorFullscreen,
      drawerFullscreen,
      stateSpecificPlacementValid: placementFailure === null,
      placementFailure,
    })
    emitRuntimeAudit('DOCUMENT-UTILITY-BCR', {
      reason,
      geometryCommitted: committed,
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
   * Phase 7R.3.11.6 — state-specific placement failure detector. Uses the SAME
   * geometry helper as production (no second formula): expectedRight is the
   * drawer-state-dependent navRight; actualRight = innerWidth - navRect.right.
   */
  private computePlacementFailure(): 'NAVIGATOR_STALE_DRAWER_OFFSET' | 'NAVIGATOR_NOT_AT_AVOIDANCE_POSITION' | null {
    const result = evaluateNavigatorPlacement({
      drawerOpen: this.drawerOpen,
      navigatorRect: this.latestRects.navigator,
      shellRect: this.latestRects.shell,
      viewport: { width: window.innerWidth, height: window.innerHeight },
      tolerancePx: NAV_PLACEMENT_TOLERANCE_PX,
    })
    return result.decision === 'PASS' ? null : result.decision
  }

  /** Phase 7R.3.11.6 — NAV-PLACEMENT runtime audit (post-commit only). */
  private emitNavigatorPlacementAudit(reason: string): void {
    const viewport = { width: window.innerWidth, height: window.innerHeight }
    const nav = this.latestRects.navigator
    const drawer = this.latestRects.drawer
    const result = evaluateNavigatorPlacement({
      drawerOpen: this.drawerOpen,
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
    })
  }

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
   * Phase 7R.3.11.5 — scroll navigator BUTTON action audit.
   * Only user clicks on ↑/↓ reach this path (never wheel / scroll restore /
   * document switch). Records scrollTop before, the requested target, and the
   * settled scrollTop read on a one-shot timer (smooth scroll is async).
   * Phase 7R.3.11.8-A — the legacy fixed-250ms audit is kept UNCHANGED as a
   * passive observer; a low-noise operation forensic tracks the real scroll
   * events + quiescence so the root cause (premature audit vs incomplete
   * scroll) can be proven WITHOUT altering the business behavior.
   */
  private handleScrollAction(action: 'GO_TOP' | 'GO_BOTTOM'): void {
    const container = getActiveEditorScrollContainer()
    if (!container) return
    const scrollTopBefore = container.scrollTop
    const maxScrollTop = Math.max(0, container.scrollHeight - container.clientHeight)
    if (action === 'GO_TOP') this.scrollNav?.scrollToTop()
    else this.scrollNav?.scrollToBottom()
    const drawerVisible = this.drawerOpen
    const locked = this.editGuard.isLocked()
    this.startScrollOperationForensic(action, container, scrollTopBefore, maxScrollTop, drawerVisible, locked)
    const audit = (): void => {
      const payload = buildScrollNavAudit({
        documentKey: this.opts.ctx.authority.getDocumentKey(),
        action,
        scrollTopBefore,
        scrollTopAfter: container.scrollTop,
        maxScrollTop,
        drawerVisible,
        locked,
      })
      emitRuntimeAudit('DOCUMENT-UTILITY-SCROLL-NAV', { ...payload })
      this.recordScrollOperationLegacyCheck(container.scrollTop, maxScrollTop, payload.decision)
    }
    if (typeof setTimeout === 'function') {
      setTimeout(audit, 250)
    } else {
      audit()
    }
  }

  // ── Phase 7R.3.11.8-A — scroll operation forensic (observability only) ──
  private startScrollOperationForensic(
    action: 'GO_TOP' | 'GO_BOTTOM',
    container: HTMLElement,
    scrollTopStart: number,
    maxScrollTopStart: number,
    drawerVisible: boolean,
    locked: boolean,
  ): void {
    // A new click supersedes an in-flight forensic (release listeners/timers).
    if (this.scrollOpForensic) this.finalizeScrollOperationForensic('SUPERSEDED')
    const operationId = ++this.scrollNavOperationSeq
    const record: ScrollNavOperationForensicRecord = {
      operationId,
      action,
      source: 'BUTTON',
      documentKey: this.opts.ctx.authority.getDocumentKey(),
      containerTag: container.tagName,
      containerId: container.id || '',
      containerClass: String(container.className || '').slice(0, 60),
      containerConnected: container.isConnected,
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
      scrollTopFinal: scrollTopStart,
      maxScrollTopFinal: maxScrollTopStart,
      targetReached: false,
      elapsedMs: 0,
      settleReason: 'SAFETY_TIMEOUT',
      drawerVisibleAtStart: drawerVisible,
      lockedAtStart: locked,
    }
    const onScroll = (): void => {
      const t = container.scrollTop
      const max = Math.max(0, container.scrollHeight - container.clientHeight)
      if (record.scrollEventCount > 0) {
        const movingTowardBottom = t > record.scrollTopLastObserved
        if ((action === 'GO_BOTTOM' && !movingTowardBottom && t < record.scrollTopLastObserved - 1)
          || (action === 'GO_TOP' && movingTowardBottom && t > record.scrollTopLastObserved + 1)) {
          record.reversalCount++
        }
      }
      record.scrollEventCount++
      if (record.firstScrollEventTs === null) record.firstScrollEventTs = performance.now()
      record.lastScrollEventTs = performance.now()
      record.scrollTopLastObserved = t
      record.maxScrollTopLastObserved = max
      if (this.scrollOpForensic) {
        if (this.scrollOpForensic.settleTimer) clearTimeout(this.scrollOpForensic.settleTimer)
        this.scrollOpForensic.settleTimer = setTimeout(
          () => this.finalizeScrollOperationForensic('QUIESCENCE'),
          SCROLL_NAV_QUIESCENCE_MS,
        )
      }
    }
    container.addEventListener('scroll', onScroll, { passive: true })
    const safetyDeadline = setTimeout(
      () => this.finalizeScrollOperationForensic('SAFETY_TIMEOUT'),
      SCROLL_NAV_SAFETY_DEADLINE_MS,
    )
    this.scrollOpForensic = { record, container, settleTimer: null, safetyDeadline, onScroll }
  }

  private recordScrollOperationLegacyCheck(scrollTopAfter: number, maxScrollTop: number, legacyDecision: 'PASS' | 'FAIL'): void {
    const op = this.scrollOpForensic
    if (!op) return
    op.record.scrollTopAtLegacyCheck = scrollTopAfter
    op.record.legacyWouldPass = legacyDecision === 'PASS'
    op.record.maxScrollTopLastObserved = maxScrollTop
  }

  private finalizeScrollOperationForensic(reason: ScrollNavOperationSettleReason): void {
    const op = this.scrollOpForensic
    if (!op) return
    this.scrollOpForensic = null
    op.container.removeEventListener('scroll', op.onScroll)
    if (op.settleTimer) clearTimeout(op.settleTimer)
    if (op.safetyDeadline) clearTimeout(op.safetyDeadline)
    const r = op.record
    r.settleReason = reason
    r.scrollTopFinal = op.container.scrollTop
    r.maxScrollTopFinal = Math.max(0, op.container.scrollHeight - op.container.clientHeight)
    const tol = SCROLL_NAV_TARGET_TOLERANCE_PX
    r.targetReached = r.action === 'GO_TOP'
      ? Math.abs(r.scrollTopFinal - 0) <= tol
      : Math.abs(r.scrollTopFinal - r.maxScrollTopFinal) <= tol
    r.elapsedMs = performance.now() - r.startTs
    emitRuntimeAudit('DOCUMENT-UTILITY-SCROLL-NAV-FORENSIC', { ...r })
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

    const target = d.locator?.targetElement ?? null
    if (target) {
      const locate = document.createElement('button')
      locate.type = 'button'
      locate.className = 'inkchapter-doc-drawer__item-locate'
      locate.setAttribute(UTILITY_UI_ROOT_ATTR, UTILITY_UI_ROOT_VALUE)
      locate.textContent = '定位'
      locate.addEventListener('click', () => {
        const result = this.locator.locate(target)
        if (!result.located) this.showToast('目标已变化，请重新检查')
      })
      item.appendChild(locate)
    }

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
