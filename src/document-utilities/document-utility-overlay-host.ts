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
import { emitRuntimeAudit } from '../runtime/forensic-log-sink'

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

/**
 * Phase 7R.3.11.1 — resolve overlay placements in VIEWPORT coordinates from the
 * editor shell rect. Pure (read-only) — the host applies the result via a
 * single coalesced rAF write. Values are only meaningful when the overlay root
 * is a full-viewport containing block (see Strategy B); a 0×0 root would turn
 * these absolute positions into off-screen coordinates.
 */
export function computeOverlayGeometry(
  shellRect: { top: number; right: number; bottom: number } | null,
  viewport: { width: number; height: number },
): OverlayGeometry {
  const right = shellRect && shellRect.right > 0 ? Math.max(0, viewport.width - shellRect.right) : 0
  const top = shellRect && shellRect.top > 0 ? shellRect.top : 0
  const bottomGap = shellRect && shellRect.bottom > 0 ? Math.max(0, viewport.height - shellRect.bottom) : 0
  return {
    toolbarTop: top + TOOLBAR_TOP_PX,
    toolbarRight: right + TOOLBAR_RIGHT_PX,
    navRight: right + NAV_RIGHT_PX,
    navBottom: bottomGap + NAV_BOTTOM_PX,
    drawerTop: top + DRAWER_TOP_PX,
    drawerRight: right + DRAWER_RIGHT_PX,
    drawerBottom: bottomGap + DRAWER_BOTTOM_PX,
  }
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
  private lastGeometry: OverlayGeometry | null = null
  private readonly geometryCounters = {
    callbackCount: 0,
    windowResizeEventCount: 0,
    scheduleCount: 0,
    executionCount: 0,
    writeCount: 0,
    noopCount: 0,
    sameFrameCoalesceCount: 0,
    feedbackLoopSuspectCount: 0,
    warningCorrelationCount: 0,
  }
  private lastRoCallbackTs: number | null = null
  private lastGeometryWriteTs: number | null = null
  private lastWindowResizeTs: number | null = null
  private lastViewportWidth = 0
  private latestRects: { write: RectRecord | null; shell: RectRecord | null; overlayRoot: RectRecord | null; toolbar: RectRecord | null; navigator: RectRecord | null; drawer: RectRecord | null } = {
    write: null, shell: null, overlayRoot: null, toolbar: null, navigator: null, drawer: null,
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
    this.editGuard = new DocumentEditGuard()
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
      this.resizeObserver = new ResizeObserver((entries) => {
        this.geometryCounters.callbackCount++
        this.lastRoCallbackTs = this.now()
        // Feedback-suspect detection: a callback right after a utility write,
        // with an unchanged viewport, on the same observed shell.
        const viewportWidthChanged = this.lastViewportWidth !== window.innerWidth
        this.lastViewportWidth = window.innerWidth
        const msSinceWrite = this.lastGeometryWriteTs == null ? null : this.now() - this.lastGeometryWriteTs
        const verdict = classifyResizeSource({ viewportWidthChanged, msSinceUtilityWrite: msSinceWrite, feedbackWindowMs: 80 })
        if (verdict === 'UTILITY_FEEDBACK_LOOP') {
          this.geometryCounters.feedbackLoopSuspectCount++
        }
        void entries
        this.scheduleGeometrySync('resize-observer')
      })
      this.resizeObserver.observe(container)
    }
    window.addEventListener('resize', this.onWindowResize)
    this.lastViewportWidth = window.innerWidth
    this.installWarningObserver()
    this.scheduleGeometrySync('mount')

    // Diagnostics subscription → toolbar badge.
    this.disposables.push(this.diagnostics.subscribe((snapshot) => {
      this.snapshot = snapshot
      this.renderDiagnosticsButton()
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
    emitRuntimeAudit('DOCUMENT-UTILITY-LIFECYCLE', {
      action: 'BIND_DOCUMENT',
      rootCount: document.querySelectorAll(`[${UTILITY_ROOT_IDENTITY_ATTR}="true"]`).length,
      toolbarCount: document.querySelectorAll('.inkchapter-doc-toolbar').length,
      navigatorCount: document.querySelectorAll('.inkchapter-doc-navigator').length,
    })
  }

  /** Runtime-gate observability: resize/geometry counters (read-only). */
  getGeometryCounters(): {
    callbackCount: number
    windowResizeEventCount: number
    scheduleCount: number
    executionCount: number
    writeCount: number
    noopCount: number
    sameFrameCoalesceCount: number
    feedbackLoopSuspectCount: number
    warningCorrelationCount: number
  } {
    return { ...this.geometryCounters }
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
    this.lastWindowResizeTs = this.now()
    this.lastViewportWidth = window.innerWidth
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
    if (this.geometryRafPending) {
      this.geometryCounters.sameFrameCoalesceCount++
      return
    }
    this.geometryRafPending = true
    this.geometryCounters.scheduleCount++
    const run = (): void => {
      this.geometryRafPending = false
      this.applyGeometry(reason)
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
    this.latestRects = {
      write: toRectRecord(write),
      shell: toRectRecord(shell),
      overlayRoot: toRectRecord(overlayRoot),
      toolbar: toRectRecord(toolbar),
      navigator: toRectRecord(navigator),
      drawer: toRectRecord(drawer),
    }
  }

  private applyGeometry(reason: string): void {
    if (!this.root) return
    this.geometryCounters.executionCount++
    const container = getActiveEditorScrollContainer()
    const rect = container?.getBoundingClientRect()
    const next = computeOverlayGeometry(
      rect && rect.width > 0 ? { top: rect.top, right: rect.right, bottom: rect.bottom } : null,
      { width: window.innerWidth, height: window.innerHeight },
    )
    const prev = this.lastGeometry
    this.lastGeometry = next
    if (prev && JSON.stringify(prev) === JSON.stringify(next)) {
      this.geometryCounters.noopCount++
      return
    }
    this.geometryCounters.writeCount++
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
    // In-memory rects stay fresh during bursts; full BCR is milestone-only.
    this.refreshLatestRects()
    this.emitGeometryAndVisibility(reason, next)
  }

  private emitGeometryAndVisibility(reason: string, g: OverlayGeometry): void {
    const viewport = { width: window.innerWidth, height: window.innerHeight }
    emitRuntimeAudit('DOCUMENT-UTILITY-GEOMETRY', {
      reason,
      viewport,
      writeRect: this.latestRects.write ? { left: this.latestRects.write.left, top: this.latestRects.write.top, right: this.latestRects.write.right, bottom: this.latestRects.write.bottom, width: this.latestRects.write.width, height: this.latestRects.write.height } : null,
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
   */
  private emitFullBcr(reason: string): void {
    this.refreshLatestRects()
    this.bcrEmitCount++
    const viewport = { width: window.innerWidth, height: window.innerHeight }
    const r = this.latestRects
    const toolbarFullscreen = isAccidentalFullscreenChild(r.toolbar, viewport)
    const navigatorFullscreen = isAccidentalFullscreenChild(r.navigator, viewport)
    const drawerFullscreen = r.drawer ? r.drawer.width >= viewport.width * 0.8 && r.drawer.height >= viewport.height * 0.8 : false
    emitRuntimeAudit('DOCUMENT-UTILITY-BCR', {
      reason,
      viewportWidth: viewport.width,
      viewportHeight: viewport.height,
      writeRect: r.write,
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
      toolbarInsideEditorShell: this.isInsideEditorShell(r.toolbar, r.shell),
      navigatorInsideEditorShell: this.isInsideEditorShell(r.navigator, r.shell),
      decision: toolbarFullscreen || navigatorFullscreen || drawerFullscreen ? 'FAIL_ACCIDENTAL_FULLSCREEN_CHILD' : 'VISIBLE_GEOMETRY',
    })
  }

  private isInsideEditorShell(child: RectRecord | null, shell: RectRecord | null): boolean {
    if (!child || !shell) return false
    const t = 8
    return child.left >= shell.left - t && child.right <= shell.right + t && child.top >= shell.top - t && child.bottom <= shell.bottom + t
  }

  private emitResizeSummary(): void {
    const viewport = { width: window.innerWidth, height: window.innerHeight }
    const verdict = this.geometryCounters.feedbackLoopSuspectCount > 0
      ? 'UTILITY_FEEDBACK_LOOP'
      : this.geometryCounters.warningCorrelationCount > 0
        ? 'MIXED_OR_EXTERNAL'
        : 'UNPROVEN'
    emitRuntimeAudit('DOCUMENT-UTILITY-RESIZE-SUMMARY', {
      windowMs: Math.round(this.now()),
      resizeObserverCallbackCount: this.geometryCounters.callbackCount,
      windowResizeEventCount: this.geometryCounters.windowResizeEventCount,
      geometryScheduleCount: this.geometryCounters.scheduleCount,
      geometryExecutionCount: this.geometryCounters.executionCount,
      geometryWriteCount: this.geometryCounters.writeCount,
      geometryNoopCount: this.geometryCounters.noopCount,
      sameFrameCoalesceCount: this.geometryCounters.sameFrameCoalesceCount,
      feedbackLoopSuspectCount: this.geometryCounters.feedbackLoopSuspectCount,
      warningCorrelationCount: this.geometryCounters.warningCorrelationCount,
      attributionVerdict: verdict,
      viewport,
    })
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
    topBtn.addEventListener('click', () => this.scrollNav?.scrollToTop())
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
    bottomBtn.addEventListener('click', () => this.scrollNav?.scrollToBottom())
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
      this.emitFullBcr('scroll-nav-transition')
    }
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
    this.drawerCountsEl.textContent = ''
    if (!snapshot || snapshot.documentKey == null) {
      const empty = document.createElement('div')
      empty.className = 'inkchapter-doc-drawer__item--empty'
      empty.textContent = '没有活动文档'
      this.drawerListEl.replaceChildren(empty)
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
      return
    }
    for (const d of snapshot.diagnostics) {
      this.drawerListEl.appendChild(this.buildDrawerItem(d))
    }
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

  private openDrawer(): void {
    if (!this.drawerEl) return
    this.drawerOpen = true
    this.drawerEl.style.display = 'flex'
    this.renderDrawer()
    this.scheduleGeometrySync('drawer-open')
    this.emitFullBcr('drawer-open')
    emitRuntimeAudit('DOCUMENT-UTILITY-DRAWER', {
      action: 'OPEN',
      diagnosticCount: this.snapshot?.diagnostics.length ?? 0,
      errorCount: this.snapshot?.errorCount ?? 0,
      warningCount: this.snapshot?.warningCount ?? 0,
    })
  }

  private closeDrawer(): void {
    if (!this.drawerEl) return
    this.drawerOpen = false
    this.drawerEl.style.display = 'none'
    this.emitFullBcr('drawer-close')
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
