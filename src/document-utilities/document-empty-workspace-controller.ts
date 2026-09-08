/**
 * Empty Workspace UX V1/V2 — controller. Single listener owner and single
 * marker writer.
 *
 * V2 surface authority (BUG-1 EMPTY_SURFACE_AUTHORITY_WRONG):
 *   The Empty Workspace surface is NOT the stale Markdown `#write` business
 *   root. It is resolved from the ACTIVE empty workspace leaf itself:
 *
 *     workspace.activeLeaf → active leaf .view (core.empty) → view.containerEl
 *
 * The resolver is injected (framework/workspace adapter). The controller only
 * binds a dblclick listener when presenceState=EMPTY AND the resolved surface
 * is connected AND owned by that active leaf. On every lifecycle sync the old
 * surface is detached before a new one is bound (count ≤ 1). No
 * document/body global dblclick is ever used.
 */
import { emitRuntimeAudit } from '../runtime/forensic-log-sink'
import { EmptyCreateTransactionGuard } from './document-empty-workspace'
import {
  EMPTY_DEFAULT_BASE_NAME,
  EMPTY_FILE_EXT,
  EMPTY_NAME_COLLISION_MAX,
  EMPTY_PLACEHOLDER_ATTR,
  applyEmptyPlaceholderTabState,
  findEmptyPlaceholderMarkedTabs,
  isInteractiveDoubleClickTarget,
  isEmptyPlaceholderTab,
  readFileTreeSelectionPath,
  resolveEmptyWorkspaceCreateDirectory,
  resolveUncollidedMarkdownName,
} from './document-empty-workspace'
import type { EmptyCreateDecisionReason } from './document-empty-workspace'

export type EmptyWorkspacePresenceState = 'ACTIVE' | 'EMPTY' | 'UNKNOWN'

export interface EmptyWorkspacePresence {
  state: EmptyWorkspacePresenceState
  path: string | null
  source?: 'ACTIVE_LEAF_PATH' | 'ACTIVE_LEAF_EMPTY' | 'ACTIVE_LEAF_UNAVAILABLE'
}

/**
 * Facts returned by the active-empty-leaf surface resolver (workspace adapter).
 * `surface` is the view-owned connected container of the CURRENT EMPTY leaf —
 * never #write. `belongsToActiveLeaf` is always true for source
 * ACTIVE_EMPTY_LEAF_VIEW because it is derived from the active leaf directly.
 */
export interface EmptyWorkspaceSurfaceFacts {
  surface: HTMLElement | null
  source:
    | 'ACTIVE_EMPTY_LEAF_VIEW'
    | 'NO_ACTIVE_LEAF'
    | 'NOT_EMPTY_VIEW'
    | 'VIEW_CONTAINER_MISSING'
    | 'INJECTED'
  activeLeafExists: boolean
  activeLeafViewType: string | null
}

export interface EmptyWorkspaceCreateResult {
  ok: boolean
  path: string | null
  code?: 'EXISTS' | 'ERROR' | 'OK'
}

export interface EmptyWorkspaceUxPlatform {
  getFileTreeRoot(): string | null
  statKind?(absolutePath: string): 'directory' | 'file' | null
  markdownExists?(absolutePath: string): boolean
  createExclusiveMarkdown(directory: string, fileName: string): EmptyWorkspaceCreateResult
  openCreatedFile?(path: string): Promise<void> | void
  revealInFileTree?(path: string): Promise<boolean> | boolean
  notice?(message: string): void
}

export interface EmptyWorkspaceUxControllerOptions {
  platform: EmptyWorkspaceUxPlatform
  getPresence(): EmptyWorkspacePresence
  /** V2 — authoritative resolver (active EMPTY leaf view surface). */
  resolveEmptySurface?(): EmptyWorkspaceSurfaceFacts | null
  /** Legacy/injectable resolver kept for tests that inject a raw surface. */
  resolveSurface?(): HTMLElement | null
  /** Allow double-click when the surface itself is contenteditable (EMPTY only). */
  contentEditableBoundaryAllowed?: boolean
}

export interface EmptyWorkspaceUxRuntimeFacts {
  dblclickListenerCount: number
  emptyPlaceholderMarkerCount: number
}

interface EmptyTabCloseFacts {
  presenceState: EmptyWorkspacePresenceState
  activeLeafPath: string
  emptyTabResolved: boolean
  emptyMarkerApplied: boolean
  closeEligible: boolean
  closeDisplay: string | null
  closeVisibility: string | null
  closeOpacity: string | null
  closePointerEvents: string | null
  closeRenderedVisible: boolean
}

export class EmptyWorkspaceUxController {
  private surfaceBound: HTMLElement | null = null
  private dblclickCount = 0
  private txn = new EmptyCreateTransactionGuard()
  private disposed = false
  private lastMarkerSnapshot = { tabFound: false, markerApplied: false }
  private lastSurfaceFacts: EmptyWorkspaceSurfaceFacts | null = null

  constructor(private readonly opts: EmptyWorkspaceUxControllerOptions) {}

  getRuntimeFacts(): EmptyWorkspaceUxRuntimeFacts {
    return {
      dblclickListenerCount: this.dblclickCount,
      emptyPlaceholderMarkerCount: findEmptyPlaceholderMarkedTabs(document).length,
    }
  }

  /** Call on every presence change / document switch / tab structure mutation. */
  sync(presence: EmptyWorkspacePresence): void {
    if (this.disposed) return
    try {
      const empty = presence.state === 'EMPTY'
      this.lastMarkerSnapshot = applyEmptyPlaceholderTabState(document, empty)
      this.syncSurfaceBinding(presence)
      this.emitEmptyTabInvariant(presence)
      this.emitSurfaceInvariant(presence)
    } catch { /* best-effort */ }
  }

  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    this.detachSurfaceListener()
    applyEmptyPlaceholderTabState(document, false)
  }

  private syncSurfaceBinding(presence: EmptyWorkspacePresence): void {
    const empty = presence.state === 'EMPTY'
    if (!empty) {
      this.detachSurfaceListener()
      return
    }
    const facts = this.resolveSurfaceFacts()
    this.lastSurfaceFacts = facts
    const surface = facts?.surface ?? null
    const ownedByActiveEmptyLeaf = facts?.source === 'ACTIVE_EMPTY_LEAF_VIEW' || facts?.source === 'INJECTED'
    if (!ownedByActiveEmptyLeaf || !surface || !surface.isConnected) {
      // Surface unavailable / not owned by the active EMPTY leaf / disconnected
      // → never bind (the old stale surface was already detached above).
      this.detachSurfaceListener()
      return
    }
    if (surface === this.surfaceBound) return // already bound once
    this.detachSurfaceListener()
    this.surfaceBound = surface
    // V3 — capture-phase listener: the empty leaf surface receives the event
    // before any of its child bubbles do; it is still fully scoped to the
    // surface (never document/body).
    surface.addEventListener('dblclick', this.onSurfaceDoubleClick, true)
    this.dblclickCount = 1
  }

  private detachSurfaceListener(): void {
    if (this.surfaceBound) {
      this.surfaceBound.removeEventListener('dblclick', this.onSurfaceDoubleClick, true)
      this.surfaceBound = null
      this.dblclickCount = 0
    }
  }

  private resolveSurfaceFacts(): EmptyWorkspaceSurfaceFacts | null {
    try {
      if (this.opts.resolveEmptySurface) {
        const f = this.opts.resolveEmptySurface()
        if (f) return f
      }
      if (this.opts.resolveSurface) {
        const s = this.opts.resolveSurface()
        return {
          surface: s,
          source: 'INJECTED',
          activeLeafExists: s != null,
          activeLeafViewType: null,
        }
      }
      return null
    } catch {
      return null
    }
  }

  private readonly onSurfaceDoubleClick = (e: MouseEvent): void => {
    if (this.disposed) return
    const surface = this.surfaceBound
    const presence = this.opts.getPresence()
    const empty = presence.state === 'EMPTY'
    const facts = this.lastSurfaceFacts
    const surfaceResolved = facts?.surface != null && facts.surface === surface && surface?.isConnected === true
    const surfaceMatchesBound = e.target instanceof Node && !!surface && (e.target === surface || surface.contains(e.target))
    const interactive = isInteractiveDoubleClickTarget(e.target, surface)

    // V3 — FIRST action in the handler: record the REAL receipt before any
    // guard runs (guards can only ever cause an explicit logged REJECT).
    this.emitDblclickReceipt(e, presence)

    if (!empty) {
      this.emitCreateInvariant(presence, e, facts, false, 'REJECT_PRESENCE_NOT_EMPTY', null, null, {
        reason: 'EMPTY_PRESENCE_REQUIRED',
        surfaceResolved,
        surfaceBelongsToActiveLeaf: surfaceResolved,
        surfaceMatchesBoundListenerTarget: surfaceMatchesBound,
      })
      return
    }
    if (e.button !== 0) {
      this.emitCreateInvariant(presence, e, facts, false, 'REJECT_NOT_LEFT', null, null, {
        reason: 'LEFT_BUTTON_REQUIRED',
        surfaceResolved,
        surfaceBelongsToActiveLeaf: true,
        surfaceMatchesBoundListenerTarget: surfaceMatchesBound,
      })
      return
    }
    if (e.detail < 2) {
      this.emitCreateInvariant(presence, e, facts, false, 'REJECT_DETAIL', null, null, {
        reason: 'DETAIL_AT_LEAST_2_REQUIRED',
        surfaceResolved,
        surfaceBelongsToActiveLeaf: true,
        surfaceMatchesBoundListenerTarget: surfaceMatchesBound,
      })
      return
    }
    if (!surfaceResolved) {
      this.emitCreateInvariant(presence, e, facts, false, 'REJECT_STALE_SURFACE', null, null, {
        reason: 'STALE_OR_DISCONNECTED_SURFACE',
        surfaceResolved: false,
        surfaceBelongsToActiveLeaf: false,
        surfaceMatchesBoundListenerTarget: false,
      })
      return
    }
    if (!surfaceMatchesBound) {
      this.emitCreateInvariant(presence, e, facts, false, 'REJECT_SURFACE_MISMATCH', null, null, {
        reason: 'EVENT_TARGET_OUTSIDE_BOUND_SURFACE',
        surfaceResolved,
        surfaceBelongsToActiveLeaf: true,
        surfaceMatchesBoundListenerTarget: false,
      })
      return
    }
    if (interactive) {
      this.emitCreateInvariant(presence, e, facts, true, 'REJECT_INTERACTIVE_TARGET', null, null, {
        reason: 'INTERACTIVE_CONTROL_TARGET',
        surfaceResolved,
        surfaceBelongsToActiveLeaf: true,
        surfaceMatchesBoundListenerTarget: true,
      })
      return
    }
    if (!this.txn.startCreate()) {
      this.emitCreateInvariant(presence, e, facts, false, 'IGNORE_TXN_BUSY', null, null, {
        reason: 'TRANSACTION_BUSY',
        surfaceResolved,
        surfaceBelongsToActiveLeaf: true,
        surfaceMatchesBoundListenerTarget: true,
      })
      return
    }
    void this.runCreate(presence, e, facts, surface)
  }

  /** V3 — real-event receipt, emitted as the FIRST side effect of the handler. */
  private emitDblclickReceipt(e: MouseEvent, presence: EmptyWorkspacePresence): void {
    let composedPathSer: unknown = null
    try {
      composedPathSer = e.composedPath().map((n) => {
        if (n instanceof Element) {
          return {
            tag: (n.tagName || '').toLowerCase(),
            id: n.id || null,
            class: typeof n.className === 'string' ? n.className : null,
          }
        }
        return String(n)
      })
    } catch { /* best-effort */ }
    emitRuntimeAudit('DOCUMENT-UTILITY-EMPTY-WORKSPACE-DBLCLICK-RECEIPT', {
      eventType: e.type,
      eventButton: e.button,
      eventDetail: e.detail,
      eventPhase: e.eventPhase,
      eventTarget: e.target instanceof Element ? (e.target.tagName || '').toLowerCase() : String(e.target),
      eventCurrentTarget: this.surfaceBound ? (this.surfaceBound.tagName || '').toLowerCase() : null,
      composedPath: composedPathSer,
      defaultPrevented: e.defaultPrevented,
      isTrusted: e.isTrusted,
      surfaceConnected: this.surfaceBound?.isConnected ?? false,
      surfaceBelongsToActiveLeaf:
        this.lastSurfaceFacts?.source === 'ACTIVE_EMPTY_LEAF_VIEW' && (this.surfaceBound?.isConnected ?? false),
      presenceState: presence.state,
      presenceSource: presence.source ?? null,
      decision: 'RECEIVED',
    })
  }

  private async runCreate(
    presenceBefore: EmptyWorkspacePresence,
    e: MouseEvent,
    facts: EmptyWorkspaceSurfaceFacts | null,
    surface: HTMLElement | null,
  ): Promise<void> {
    const platform = this.opts.platform
    const guard = this.txn
    try {
      const fileTreeRoot = platform.getFileTreeRoot()
      const selectedPath = readFileTreeSelectionPath(document)
      const selectedKind = selectedPath && platform.statKind ? platform.statKind(selectedPath) : null
      const resolution = resolveEmptyWorkspaceCreateDirectory({ root: fileTreeRoot, selectedPath, selectedKind })

      if (resolution.kind === 'reject') {
        platform.notice?.('当前未打开文件目录')
        guard.reset()
        this.emitCreateInvariant(presenceBefore, e, facts, false, 'REJECT_NO_FILE_TREE_ROOT', null, null)
        return
      }

      const baseExists = platform.markdownExists ?? (() => false)
      const tried = new Set<string>()
      const exists = (p: string): boolean => tried.has(p) || baseExists(p)

      let candidate = resolveUncollidedMarkdownName(exists, resolution.directory)
      let attempts = 0
      let created: EmptyWorkspaceCreateResult | null = null
      while (attempts < EMPTY_NAME_COLLISION_MAX) {
        attempts++
        const attempt = platform.createExclusiveMarkdown(resolution.directory, candidate.fileName)
        if (attempt.ok || attempt.code !== 'EXISTS') {
          created = attempt
          break
        }
        tried.add(candidate.absolutePath)
        candidate = resolveUncollidedMarkdownName(exists, resolution.directory, EMPTY_DEFAULT_BASE_NAME, EMPTY_FILE_EXT)
      }

      if (!created || !created.ok || !created.path) {
        guard.reset()
        this.emitCreateInvariant(presenceBefore, e, facts, false, 'CREATE_FAILED', null, null, {
          resolvedCreateDirectory: resolution.directory,
          requestedBaseName: EMPTY_DEFAULT_BASE_NAME,
          resolvedFileName: candidate.fileName,
          collisionIndex: candidate.collisionIndex,
          createAttemptCount: attempts,
        })
        return
      }

      guard.toOpening()
      let opened = false
      if (platform.openCreatedFile) {
        try {
          await platform.openCreatedFile(created.path)
          opened = true
        } catch {
          opened = false
        }
      } else {
        opened = true
      }
      if (platform.revealInFileTree) {
        try { void Promise.resolve(platform.revealInFileTree(created.path)).catch(() => undefined) } catch { /* best-effort */ }
      }
      const presenceAfter = this.opts.getPresence()
      guard.toComplete()
      guard.reset()
      this.emitCreateInvariant(
        presenceBefore,
        e,
        facts,
        false,
        opened ? 'CREATED_AND_OPENED' : 'FILE_CREATED_OPEN_FAILED',
        created.path,
        presenceAfter,
        {
          resolvedCreateDirectory: resolution.directory,
          selectedTreeNode: selectedPath,
          selectionKind: selectedKind,
          fileTreeRoot,
          requestedBaseName: EMPTY_DEFAULT_BASE_NAME,
          resolvedFileName: candidate.fileName,
          collisionIndex: candidate.collisionIndex,
          createAttemptCount: attempts,
        },
      )
    } catch {
      guard.reset()
      this.emitCreateInvariant(presenceBefore, e, facts, false, 'CREATE_FAILED', null, null)
    }
  }

  private emitCreateInvariant(
    presenceBefore: EmptyWorkspacePresence,
    e: Event,
    facts: EmptyWorkspaceSurfaceFacts | null,
    interactiveTargetRejected: boolean,
    decision: EmptyCreateDecisionReason,
    createdPath: string | null,
    presenceAfter: EmptyWorkspacePresence | null,
    extra: {
      reason?: string
      surfaceResolved?: boolean
      surfaceBelongsToActiveLeaf?: boolean
      surfaceMatchesBoundListenerTarget?: boolean
      fileTreeRoot?: string | null
      selectedTreeNode?: string | null
      selectionKind?: 'directory' | 'file' | null
      resolvedCreateDirectory?: string | null
      requestedBaseName?: string
      resolvedFileName?: string | null
      collisionIndex?: number
      createAttemptCount?: number
    } = {},
  ): void {
    const createdFileCount = decision === 'CREATED_AND_OPENED' || decision === 'FILE_CREATED_OPEN_FAILED' ? 1 : 0
    const isMouse = e instanceof MouseEvent
    emitRuntimeAudit('DOCUMENT-UTILITY-EMPTY-WORKSPACE-CREATE-INVARIANT', {
      eventReceived: true,
      eventType: e.type,
      eventButton: isMouse ? e.button : -1,
      eventDetail: isMouse ? e.detail : 0,
      rejectReason: extra.reason ?? null,
      presenceBefore: presenceBefore.state,
      presenceSource: presenceBefore.source ?? null,
      targetInsideEmptyWorkspace: extra.surfaceResolved ?? false,
      surfaceResolved: extra.surfaceResolved ?? false,
      surfaceBelongsToActiveLeaf: extra.surfaceBelongsToActiveLeaf ?? false,
      surfaceMatchesBoundListenerTarget: extra.surfaceMatchesBoundListenerTarget ?? false,
      interactiveTargetRejected,
      fileTreeRoot: extra.fileTreeRoot ?? null,
      selectedTreeNode: extra.selectedTreeNode ?? null,
      selectionKind: extra.selectionKind ?? null,
      resolvedCreateDirectory: extra.resolvedCreateDirectory ?? null,
      requestedBaseName: extra.requestedBaseName ?? EMPTY_DEFAULT_BASE_NAME,
      resolvedFileName: extra.resolvedFileName ?? null,
      collisionIndex: extra.collisionIndex ?? 0,
      txnStateBefore: this.txnBeforeLabel(decision),
      txnStateAfter: this.txn.state,
      createAttemptCount: extra.createAttemptCount ?? 0,
      createdFileCount,
      createdPath,
      openAttempted: createdFileCount === 1,
      opened: decision === 'CREATED_AND_OPENED',
      activeLeafPathAfter: presenceAfter?.path ?? this.opts.getPresence().path,
      presenceAfter: presenceAfter?.state ?? this.opts.getPresence().state,
      decision,
      reason: decision,
    })
  }

  private txnBeforeLabel(decision: EmptyCreateDecisionReason): string {
    if (decision === 'IGNORE_TXN_BUSY') return 'NON_IDLE'
    if (decision === 'CREATED_AND_OPENED' || decision === 'FILE_CREATED_OPEN_FAILED') return 'CREATING'
    return 'IDLE'
  }

  private emitEmptyTabInvariant(presence: EmptyWorkspacePresence): void {
    if (presence.state !== 'EMPTY') return
    const f = this.measureEmptyTabClose(presence)
    emitRuntimeAudit('DOCUMENT-UTILITY-EMPTY-TAB-CLOSE-INVARIANT', {
      presenceState: f.presenceState,
      activeLeafPath: f.activeLeafPath,
      emptyTabResolved: f.emptyTabResolved,
      emptyMarkerApplied: f.emptyMarkerApplied,
      closeEligible: f.closeEligible,
      closeDisplay: f.closeDisplay,
      closeVisibility: f.closeVisibility,
      closeOpacity: f.closeOpacity,
      closePointerEvents: f.closePointerEvents,
      closeRenderedVisible: f.closeRenderedVisible,
      decision: f.emptyTabResolved && f.emptyMarkerApplied && !f.closeEligible && !f.closeRenderedVisible ? 'PASS' : 'FAIL',
      reason:
        !f.emptyTabResolved || !f.emptyMarkerApplied
          ? 'EMPTY_PLACEHOLDER_TAB_NOT_RESOLVED'
          : f.closeEligible
            ? 'EMPTY_TAB_CLOSE_ELIGIBLE'
            : f.closeRenderedVisible
              ? 'EMPTY_TAB_CLOSE_RENDERED_VISIBLE'
              : 'EMPTY_TAB_CLOSE_PERMANENTLY_HIDDEN',
    })
  }

  /** V2 surface invariant: binds only to the ACTIVE EMPTY leaf view surface. */
  private emitSurfaceInvariant(presence: EmptyWorkspacePresence): void {
    if (presence.state !== 'EMPTY') return
    const facts = this.lastSurfaceFacts
    const surface = this.surfaceBound
    const businessRoot = document.getElementById('write') as HTMLElement | null
    const connected = surface != null && surface.isConnected
    const belongs = facts?.source === 'ACTIVE_EMPTY_LEAF_VIEW' && connected
    const visible = connected && surface!.getBoundingClientRect().width > 0
    let decision: 'PASS' | 'FAIL' = 'PASS'
    let reason = 'ACTIVE_EMPTY_LEAF_SURFACE_BOUND'
    if (!facts || facts.surface == null) {
      decision = 'FAIL'
      reason = facts?.source === 'NO_ACTIVE_LEAF' || facts?.source === 'NOT_EMPTY_VIEW' || facts?.source === 'VIEW_CONTAINER_MISSING'
        ? 'EMPTY_ACTIVE_LEAF_VIEW_UNAVAILABLE'
        : 'EMPTY_SURFACE_NOT_RESOLVED'
    } else if (facts.surface !== surface || !connected) {
      decision = 'FAIL'
      reason = !connected ? 'EMPTY_SURFACE_DISCONNECTED' : 'EMPTY_SURFACE_NOT_OWNED_BY_ACTIVE_LEAF'
    } else if (!belongs) {
      decision = 'FAIL'
      reason = 'EMPTY_SURFACE_NOT_OWNED_BY_ACTIVE_LEAF'
    } else if (surface === businessRoot) {
      decision = 'FAIL'
      reason = 'STALE_MARKDOWN_SURFACE_SELECTED_FOR_EMPTY'
    } else if (this.dblclickCount !== 1) {
      decision = 'FAIL'
      reason = 'EMPTY_DBLCLICK_LISTENER_DUPLICATED'
    }
    let rect: { x?: number; y?: number; width: number; height: number } = { width: 0, height: 0 }
    if (surface) {
      const r = surface.getBoundingClientRect()
      rect = { x: r.x, y: r.y, width: r.width, height: r.height }
    }
    emitRuntimeAudit('DOCUMENT-UTILITY-EMPTY-WORKSPACE-SURFACE-INVARIANT', {
      presenceState: presence.state,
      presenceSource: presence.source ?? null,
      activeLeafExists: facts?.activeLeafExists ?? false,
      activeLeafViewType: facts?.activeLeafViewType ?? null,
      activeLeafPath: presence.path ?? '',
      surfaceResolved: facts?.surface != null,
      surfaceSource: facts?.source ?? null,
      surfaceConnected: connected,
      surfaceVisible: visible,
      surfaceBelongsToActiveLeaf: belongs,
      surfaceTag: surface ? surface.tagName.toLowerCase() : null,
      surfaceClass: surface ? String(surface.className || '') : null,
      surfaceRect: rect,
      staleBusinessRootConnected: businessRoot?.isConnected ?? false,
      surfaceEqualsBusinessRoot: surface != null && surface === businessRoot,
      dblclickListenerCount: this.dblclickCount,
      decision,
      reason,
    })
  }

  private measureEmptyTabClose(presence: EmptyWorkspacePresence): EmptyTabCloseFacts {
    const marked = findEmptyPlaceholderMarkedTabs(document)
    const tab = marked[0] ?? null
    const close = tab ? tab.querySelector<HTMLElement>('.typ-icon.typ-close') : null
    const tabHasMarker = tab != null && tab.getAttribute(EMPTY_PLACEHOLDER_ATTR) === 'true'
    let display: string | null = null
    let visibility: string | null = null
    let opacity: string | null = null
    let pointerEvents: string | null = null
    if (close) {
      try {
        const cs = window.getComputedStyle(close)
        display = cs.display
        visibility = cs.visibility
        opacity = cs.opacity
        pointerEvents = cs.pointerEvents
      } catch { /* headless */ }
    }
    const tabFound = tab != null && isEmptyPlaceholderTab(tab)
    const computedHidden = display === 'none' || visibility === 'hidden' || opacity === '0'
    const renderedVisible = close != null && !(tabHasMarker || computedHidden)
    return {
      presenceState: presence.state,
      activeLeafPath: presence.path ?? '',
      emptyTabResolved: tabFound,
      emptyMarkerApplied: this.lastMarkerSnapshot.markerApplied,
      closeEligible: false,
      closeDisplay: display,
      closeVisibility: visibility,
      closeOpacity: opacity,
      closePointerEvents: pointerEvents,
      closeRenderedVisible: renderedVisible,
    }
  }
}

export { EMPTY_PLACEHOLDER_ATTR }
