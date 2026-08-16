/**
 * Outline Numbering Controller v5 — relaxed root detection, host observer with attributes.
 *
 * Key changes from v4:
 * 1. reinitialize() no longer clears currentDocumentKey — caller manages key lifecycle
 * 2. syncAfterRefresh() always applies numbering via relaxed (hidden-panel) root finder
 * 3. Host observer watches attributes (style/class) to catch hidden→visible transitions
 * 4. Event chain logging with structured data (seq, time, documentKey, renderVersion, ...)
 * 5. Root identity tracking to prevent duplicate observer binding
 * 6. RenderVersion guard to cancel stale sync operations
 */

import {
  findOutlineRoot,
  findOutlineRootRelaxed,
  findOutlineTextElements,
  matchHeadingsToOutline,
  applyNumberingAttributes,
  clearAllNumberingAttributes,
  clearFileTreeNumberingAttributes,
  fullSyncOutline,
  runOutlineProbe,
  dumpOutlineDOM,
  cleanupV2Spans,
  clearOutlineNumberBoldStyle,
  syncOutlineNumberBoldStyle,
  isApplyingOutlineBoldStyle,
  type SyncResult,
} from './outline-numbering-adapter'
import type { HeadingDescriptor } from './heading-types'
import { recordRuntimeAudit } from './runtime-audit'

interface OutlineNumberCache {
  documentKey: string
  revision: number
  headings: readonly HeadingDescriptor[]
  labels: readonly string[]
  labelGaps: readonly string[]
}

/** Event chain entry for structured logging. */
interface EventChainEntry {
  seq: number
  time: number
  event: string
  documentKey: string
  renderVersion: number
  cacheRevision: number
  outlineRootExists: boolean
  outlineRootSelector: string | null
  headingCount: number
  labelCount: number
  matchedCount: number
  appliedCount: number
}

const SIDEBAR_HOST_SELECTORS = [
  '#typora-sidebar',
  '.typora-sidebar',
  '.sidebar-content',
  '#sidebar-content',
]

/** Build marker for diagnostics. */
const CONTROLLER_BUILD_MARKER = 'inkchapter-outline-controller-v5-relaxed-root'

/** Set to false to silence event chain debug logs in production. */
const EVT_DEBUG = false
const EVT_LOG = (...args: unknown[]) => { if (EVT_DEBUG) console.log(...args) }

/** Stable 32-bit string hash (djb2) for native outline fingerprints. */
function hashFingerprint(input: string): string {
  let h = 5381
  for (let i = 0; i < input.length; i++) {
    h = ((h << 5) + h + input.charCodeAt(i)) | 0
  }
  return (h >>> 0).toString(16).padStart(8, '0')
}

// ── Real DOM Node identity (WeakMap) ──────────────────────────────
// rootToken must reflect the actual DOM Node, not a counter that can stay 0.
const rootTokenMap = new WeakMap<Node, number>()
let nextRootToken = 0

/** Resolve a stable token for a concrete DOM Node (null for unresolved). */
function getRootToken(node: Node | null): number | null {
  if (!node) return null
  let t = rootTokenMap.get(node)
  if (t === undefined) {
    t = ++nextRootToken
    rootTokenMap.set(node, t)
  }
  return t
}

/** Whether a node is itself an InkChapter-owned decoration node (strict). */
function isInkChapterOwnedNode(node: Node | null): boolean {
  if (!node) return false
  if (!(node instanceof HTMLElement)) return false
  return (
    node.hasAttribute('data-inkchapter-number') ||
    node.hasAttribute('data-inkchapter-number-gap') ||
    node.classList.contains('inkchapter-outline-number') ||
    node.hasAttribute('data-inkchapter-outline-observer-probe')
  )
}

/** Compact identity fingerprint for a mutation node (never full DOM stringify). */
function nodeIdentityFingerprint(node: Node): string {
  if (!(node instanceof HTMLElement)) return `#text:${(node.textContent ?? '').slice(0, 20)}`
  const cls = (node.className || '').split(' ').filter(c => !c.startsWith('inkchapter-')).slice(0, 3).join('.')
  return `${node.tagName}#${node.id || ''}.${cls}|${(node.textContent ?? '').replace(/\s+/g, ' ').trim().slice(0, 24)}`
}

/** Whether a node list contains any non-InkChapter (native outline) element. */
function containsNativeOutlineNode(nodes: ArrayLike<Node>): boolean {
  for (let i = 0; i < nodes.length; i++) {
    const n = nodes[i]
    if (n instanceof HTMLElement && !isInkChapterOwnedNode(n)) return true
  }
  return false
}

/** Whether a node is the hidden observer self-test probe. */
function isObserverProbe(node: Node | null): boolean {
  return node instanceof HTMLElement && node.hasAttribute('data-inkchapter-outline-observer-probe')
}

// ── Code path authority (v25) ──────────────────────────────────────
const OUTLINE_CONTROLLER_IMPL_ID = 'outline-controller-late-bind-v26-A'
let nextOutlineControllerInstanceId = 1

// Fires once when the module is first evaluated (imported). Distinguishes
// "code bundled" from "code actually loaded & executed".
console.info(
  `[InkChapter Numbering] OUTLINE-CODEPATH-MARKER site=MODULE_LOAD ` +
  `implId=${OUTLINE_CONTROLLER_IMPL_ID} modulePath=outline-numbering-controller.ts`,
)

export class OutlineNumberingController {
  private readonly instanceId = `outline-controller-${nextOutlineControllerInstanceId++}`
  private observer: MutationObserver | null = null
  private observerRoot: HTMLElement | null = null
  private sidebarHostObserver: MutationObserver | null = null
  private rafId: number | null = null
  private isObserverActive = false
  private isWriting = false
  private cache: OutlineNumberCache = { documentKey: '', revision: 0, headings: [], labels: [], labelGaps: [] }
  private currentDocumentKey = ''
  private renderVersion = 0

  // Live reapply state
  private pendingReasons = new Set<string>()
  private verifyRafId: number | null = null
  private verifyRepairByRevision = new Map<number, number>()
  private lastApply: {
    matchedCount: number
    appliedCount: number
    unmatchedCount: number
    unmatchedOutlineCount: number
    staleDecorationCount: number
    reason: string
  } | null = null
  private lastVerify: { expectedCount: number; actualCount: number; decision: string } | null = null

  // Root identity — real HTMLElement reference + generation/token (never selector string).
  // rootToken: WeakMap-derived DOM node identity. null = no root, 1+ = concrete node.
  private rootGeneration = 0
  private rootToken: number | null = null
  private lastApplyTransaction: {
    transactionId: string
    documentKey: string
    snapshotRevision: number
    root: HTMLElement
    rootToken: number | null
    rootGeneration: number
  } | null = null

  // Root availability wait (NO_VISIBLE_OUTLINE_ROOT → DEFER + wakeup).
  private pendingForVisibleRoot = false
  private pendingDocumentKey = ''
  private pendingRevision = 0
  private resizeObserver: ResizeObserver | null = null
  private lastAvailabilityReason = ''
  private availabilityCandidateFound = false
  private availabilityCandidateConnected = false
  private availabilityCandidateVisible = false

  // Native outline subtree tracking (MODEL F — Typora rebuilds native items
  // AFTER InkChapter apply, wiping decorations). Root identity alone cannot
  // detect this; we must track the subtree mutation epoch + generation.
  private nativeMutationEpoch = 0
  private nativeSubtreeGeneration = 0
  private nativeItemCount = 0
  private nativeTextFingerprint = ''
  private nativeStructureFingerprint = ''
  private lastNativeMutationAt: number | null = null
  private lastInkchapterMutationAt: number | null = null
  private lastSampleEpoch = 0

  // Post-apply stability barrier: record epoch/generation at apply and detect
  // whether Typora mutates the native subtree AFTER decoration was written.
  private postApplyEpochAtApply = 0
  private postApplyGenerationAtApply = 0

  // Native quiescence debounce: wait until the native mutation burst is stable
  // for one RAF before applying (never a fixed setTimeout).
  private nativeQuiescenceEpoch = -1
  private nativeQuiescenceRafId: number | null = null

  // Diagnostic counters
  private observerBindCount = 0
  private observerDisconnectCount = 0
  private eventSeq = 0

  // Observer coverage-gap diagnostics (v24): real DOM node identity + lifecycle.
  private observerGeneration = 0
  private observedRootToken: number | null = null
  private observerBoundaryLevel = 'L0'
  private callbackCount = 0
  private rawMutationRecordCount = 0
  private selfTestPassed = false
  private probeAddedSeen = false
  private probeRemovedSeen = false

  // Decoration loss watchdog state.
  private lastAppliedDecorationCount = 0
  private lastAppliedRevision = 0
  private lastAppliedRootToken: number | null = null

  // Click handler reference for cleanup
  private sidebarModeClickHandler: ((e: Event) => void) | null = null

  constructor() {
    console.info(
      `[InkChapter Numbering] OUTLINE-CODEPATH-MARKER site=CONTROLLER_CONSTRUCTOR ` +
      `implId=${OUTLINE_CONTROLLER_IMPL_ID} instanceId=${this.instanceId} timestamp=${Date.now()}`,
    )
  }

  start(): void {
    EVT_LOG(`[InkChapter OUTLINE] controller start  build=${CONTROLLER_BUILD_MARKER}`)
    this.bindSidebarHostObserver()
    this.ensureObserverBoundToCurrentRoot('startup')
    this.bindSidebarModeClickListener()
    this.dumpSidebarTabButton()
    cleanupV2Spans()
    clearFileTreeNumberingAttributes()
    this.registerProbe()
  }

  stop(): void {
    console.info(
      `[InkChapter Numbering] OUTLINE-OBSERVER-LIFECYCLE action=DISPOSE observerGeneration=${this.observerGeneration} ` +
      `rootToken=${this.observedRootToken} callbackCount=${this.callbackCount} selfTestPassed=${this.selfTestPassed} reason=controller-stop`,
    )
    this.detachObserver()
    this.detachSidebarHostObserver()
    this.detachSidebarModeClickListener()
    this.stopAvailabilityWatch()
    if (this.rafId !== null) { cancelAnimationFrame(this.rafId); this.rafId = null }
    if (this.verifyRafId !== null) { cancelAnimationFrame(this.verifyRafId); this.verifyRafId = null }
    if (this.nativeQuiescenceRafId !== null) { cancelAnimationFrame(this.nativeQuiescenceRafId); this.nativeQuiescenceRafId = null }
    const root = findOutlineRoot()
    clearAllNumberingAttributes(root)
    clearFileTreeNumberingAttributes()
    clearOutlineNumberBoldStyle()
  }

  /** Clear all outline numbering without stopping the controller. */
  clearOutlineNumbering(): void {
    const root = findOutlineRoot()
    clearAllNumberingAttributes(root)
    clearFileTreeNumberingAttributes()
    clearOutlineNumberBoldStyle()
    this.cache = { documentKey: '', revision: 0, headings: [], labels: [], labelGaps: [] }
  }

  /** Get cached headings for level mapping (used by collapse depth filter). */
  getCachedHeadings(): readonly HeadingDescriptor[] {
    return this.cache.headings
  }

  /**
   * Reinitialize for a new document: detach old observer, find new outline root.
   * Does NOT clear currentDocumentKey — the caller must call setDocumentKey()
   * BEFORE or AFTER reinitialize() to set the correct key.
   * Cache is NOT applied here (caller ensures new cache is generated first).
   */
  reinitialize(): void {
    this.recordEvent('outline:reinitialize', {
      headingCount: 0, labelCount: 0, matchedCount: 0, appliedCount: 0,
    })
    this.detachObserver()
    // Try to reattach to current outline root (may be null if panel hidden)
    this.ensureObserverBoundToCurrentRoot('reinitialize')
    clearFileTreeNumberingAttributes()
  }

  /** Set current document key. Returns the bind decision (NO_OP when unchanged). */
  setDocumentKey(key: string): { decision: 'BIND' | 'REBIND' | 'NO_OP'; before: string; after: string } {
    const before = this.currentDocumentKey
    if (key === before) return { decision: 'NO_OP', before, after: before }
    this.currentDocumentKey = key
    // Document switch: any pending visible-root wait belongs to the previous
    // document. Make it stale so a later root-available can never wake an old
    // document's snapshot (T10 / pending-cleanup-on-document-switch).
    if (this.pendingForVisibleRoot) {
      this.pendingForVisibleRoot = false
      this.pendingDocumentKey = ''
      this.pendingRevision = 0
      this.lastAvailabilityReason = 'DOCUMENT_SWITCH_PENDING_STALE'
    }
    return { decision: before === '' ? 'BIND' : 'REBIND', before, after: key }
  }

  /**
   * Sync the outline document context from an authoritative key (startup
   * catch-up / DOCUMENT-CONTEXT-READY / file-open / document-switch).
   * Never clears the key once set; empty authoritative key is a NO_OP.
   */
  syncDocumentContext(authoritativeKey: string | null, reason: string): { decision: 'BIND' | 'REBIND' | 'NO_OP'; before: string; after: string } {
    const key = authoritativeKey ?? ''
    const before = this.currentDocumentKey
    if (!key) {
      console.info(`[InkChapter Numbering] OUTLINE-DOCUMENT-CONTEXT-SYNC reason=${reason} authoritativeKey=none controllerBefore=${before || 'none'} decision=NO_OP`)
      return { decision: 'NO_OP', before, after: before }
    }
    const result = this.setDocumentKey(key)
    console.info(
      `[InkChapter Numbering] OUTLINE-DOCUMENT-CONTEXT-SYNC reason=${reason} authoritativeKey=${key} ` +
      `controllerBefore=${before || 'none'} controllerAfter=${result.after} decision=${result.decision}`,
    )
    return result
  }

  /** Bump render version (called on document switch). */
  bumpRenderVersion(): void {
    this.renderVersion++
  }

  /** Get current render version for stale-op detection. */
  private getRenderVersion(): number {
    return this.renderVersion
  }

  /**
   * Sync after heading refresh — update the outline snapshot (cache) and
   * automatically schedule a reapply against the CURRENT outline root.
   * Empty authoritative key is BLOCKED; a mismatched controller key is
   * REPAIRED (BIND/REBIND) and the SAME invocation continues to snapshot.
   */
  syncAfterRefresh(
    documentKey: string,
    headings: readonly HeadingDescriptor[],
    labels: readonly string[],
    labelGaps?: readonly string[],
  ): void {
    console.info(
      `[InkChapter Numbering] OUTLINE-CODEPATH-MARKER site=SYNC_AFTER_REFRESH ` +
      `implId=${OUTLINE_CONTROLLER_IMPL_ID} instanceId=${this.instanceId} documentKey=${documentKey}`,
    )
    const controllerKey = this.currentDocumentKey

    // ── Document identity invariant ──
    if (!documentKey) {
      console.info('[InkChapter Numbering] OUTLINE-DOCUMENT-IDENTITY-INVARIANT decision=BLOCK reason=EMPTY_DOCUMENT_KEY')
      return
    }
    if (documentKey !== controllerKey) {
      // Repairable: bind/rebind the authoritative key and CONTINUE this round.
      const result = this.setDocumentKey(documentKey)
      console.info(
        `[InkChapter Numbering] OUTLINE-CONTEXT-REPAIR authoritative=${documentKey} ` +
        `controllerBefore=${controllerKey || 'none'} controllerAfter=${result.after} decision=${result.decision}`,
      )
    }

    // Generate new cache with current document identity. Revision always
    // advances on a real heading refresh (never skipped by heading-count-only).
    this.cache = {
      documentKey,
      revision: this.cache.revision + 1,
      headings,
      labels,
      labelGaps: labelGaps ?? [],
    }

    console.info(
      `[InkChapter Numbering] OUTLINE-DOCUMENT-IDENTITY-INVARIANT decision=PASS ` +
      `authoritative=${documentKey} controller=${documentKey} snapshot=${documentKey}`,
    )
    console.info(
      `[InkChapter Numbering] OUTLINE-SNAPSHOT documentKey=${documentKey} ` +
      `revision=${this.cache.revision} headingCount=${headings.length} labelCount=${labels.length} decision=UPDATED`,
    )

    this.recordEvent('outline:cache-updated', {
      headingCount: headings.length,
      labelCount: labels.length,
      matchedCount: 0,
      appliedCount: 0,
    })

    // Clear any accidental file tree pollution immediately
    clearFileTreeNumberingAttributes()

    // Cache update IS the apply trigger — but wait for Typora's native outline
    // subtree mutation burst to settle before applying (MODEL F: applying before
    // the native rebuild settles gets the decoration wiped).
    this.schedulePostNativeApply('heading-snapshot-updated')
  }

  /** Full sync with diagnostic output (for manual command). */
  manualSync(callback: (log: string) => void): SyncResult {
    return fullSyncOutline(this.cache.headings, this.cache.labels, callback, this.cache.labelGaps)
  }

  /** Run diagnostic probe (for manual command). */
  runProbe(callback: (log: string) => void): void {
    const result = runOutlineProbe(callback)
    if (result) {
      callback('[InkChapter:outline-probe] probeVisible=待用户确认')
    }
  }

  /** Run full DOM diagnostic dump (for manual command). */
  dumpDOM(): void {
    dumpOutlineDOM()
  }

  // ── Sidebar host observer (stable, persists across tab switches) ──

  /** Observe the stable sidebar parent for outline DOM insertion AND attribute changes. */
  private bindSidebarHostObserver(): void {
    this.detachSidebarHostObserver()
    const host = this.findSidebarHost()
    this.recordEvent('outline:host-observer-bind', {
      headingCount: 0, labelCount: 0, matchedCount: 0, appliedCount: 0,
    })
    if (!host) {
      EVT_LOG('[InkChapter OUTLINE] sidebarHostObserver: host not found, retrying with relaxed search')
      const hostRelaxed = this.findSidebarHostRelaxed()
      if (hostRelaxed && hostRelaxed.isConnected) {
        EVT_LOG(`[InkChapter OUTLINE] sidebarHostObserver: bound to relaxed host ${hostRelaxed.tagName}#${hostRelaxed.id||'?'}`)
        this.observeHost(hostRelaxed)
        return
      }
      EVT_LOG('[InkChapter OUTLINE] sidebarHostObserver: no host found (visible or relaxed)')
      return
    }
    EVT_LOG(`[InkChapter OUTLINE] sidebarHostObserver: bound to ${host.tagName}#${host.id||'?'}.${host.className||'?'}`)
    this.observeHost(host)
  }

  private observeHost(host: HTMLElement): void {
    this.sidebarHostObserver = new MutationObserver((mutations) => {
      for (const m of mutations) {
        // childList: outline content inserted/removed
        if (m.type === 'childList') {
          for (let i = 0; i < m.addedNodes.length; i++) {
            const node = m.addedNodes[i]
            if (node instanceof HTMLElement) {
              if (node.id === 'outline-content' ||
                  node.classList.contains('outline-content') ||
                  node.classList.contains('outline-panel') ||
                  node.querySelector('#outline-content, .outline-content, .outline-panel')) {
                this.recordEvent('outline:host-mutation-childlist', {
                  headingCount: this.cache.headings.length,
                  labelCount: this.cache.labels.length,
                  matchedCount: 0, appliedCount: 0,
                })
                this.ensureObserverBoundToCurrentRoot('root-created')
                this.scheduleApply('outline-root-created')
                return
              }
            }
          }
        }

        // attributes: style/class changes may indicate visibility toggle
        if (m.type === 'attributes') {
          const target = m.target as HTMLElement
          const attrName = m.attributeName
          // If an outline content container's style or class changed, recheck
          if (target.id === 'outline-content' ||
              target.classList.contains('outline-content') ||
              target.classList.contains('outline-panel') ||
              target.querySelector('#outline-content, .outline-content, .outline-panel')) {
            this.recordEvent('outline:host-mutation-attributes', {
              headingCount: this.cache.headings.length,
              labelCount: this.cache.labels.length,
              matchedCount: 0, appliedCount: 0,
            })
            // The outline panel became visible (or hidden) — rebind and apply
            this.ensureObserverBoundToCurrentRoot('root-became-visible')
            this.scheduleApply('outline-root-became-visible')
            return
          }
        }
      }
    })

    this.sidebarHostObserver.observe(host, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['style', 'class'],
    })
  }

  private detachSidebarHostObserver(): void {
    if (this.sidebarHostObserver) {
      this.sidebarHostObserver.disconnect()
      this.sidebarHostObserver = null
    }
  }

  /** Find the stable sidebar parent container (visible). */
  private findSidebarHost(): HTMLElement | null {
    for (const sel of SIDEBAR_HOST_SELECTORS) {
      const el = document.querySelector(sel) as HTMLElement | null
      if (el && el.isConnected && el.offsetParent !== null) return el
    }
    return null
  }

  /** Find the stable sidebar parent container (allows hidden). */
  private findSidebarHostRelaxed(): HTMLElement | null {
    for (const sel of SIDEBAR_HOST_SELECTORS) {
      const el = document.querySelector(sel) as HTMLElement | null
      if (el && el.isConnected) return el
    }
    return null
  }

  // ── Sidebar mode click listener (capture phase, secondary only) ──

  /** Listen for clicks on sidebar tabs to catch outline activation. */
  private bindSidebarModeClickListener(): void {
    // Guard: don't bind if already bound
    if (this.sidebarModeClickHandler) return

    this.sidebarModeClickHandler = (e: Event): void => {
      const target = e.target as HTMLElement | null
      if (!target) return

      const isOutlineTab = target.matches('[data-action="switch-outline"], [data-type="outline"]') ||
                           target.closest('[data-action="switch-outline"], [data-type="outline"]') !== null ||
                           (target.classList.contains('outline') && target.closest('.typora-sidebar-tabs, .sidebar-tabs') !== null)

      if (isOutlineTab) {
        this.recordEvent('outline:tab-click', {
          headingCount: this.cache.headings.length,
          labelCount: this.cache.labels.length,
          matchedCount: 0, appliedCount: 0,
        })
        queueMicrotask(() => {
          this.ensureObserverBoundToCurrentRoot('sidebar-click')
          this.applyOutlineFromCache(this.getRenderVersion())
        })
      }
    }

    document.addEventListener('click', this.sidebarModeClickHandler, true)
  }

  private detachSidebarModeClickListener(): void {
    if (this.sidebarModeClickHandler) {
      document.removeEventListener('click', this.sidebarModeClickHandler, true)
      this.sidebarModeClickHandler = null
    }
  }

  /** Dump sidebar tab button DOM for selector verification. */
  private dumpSidebarTabButton(): void {
    const tabs = document.querySelectorAll('[data-action], [data-type], .typora-sidebar-tabs *, .sidebar-tabs *')
    const found: Array<Record<string, unknown>> = []
    for (const t of Array.from(tabs).slice(0, 6)) {
      const el = t as HTMLElement
      if (el.offsetParent === null) continue
      found.push({
        tagName: el.tagName,
        id: el.id,
        className: el.className?.split(' ').slice(0, 3).join(' '),
        dataAction: el.getAttribute('data-action'),
        dataType: el.getAttribute('data-type'),
        outerHTML: el.outerHTML.slice(0, 200),
      })
    }
    if (found.length > 0) {
      recordRuntimeAudit('sidebar-tab-scan', { details: { tabs: found } })
    }
  }

  // ── Apply cached numbering to outline (live reapply) ──────────────

  /** Coalesce all apply requests into a single RAF per frame. */
  private scheduleApply(reason: string): void {
    console.info(
      `[InkChapter Numbering] OUTLINE-CODEPATH-MARKER site=SCHEDULE_APPLY_ENTRY ` +
      `implId=${OUTLINE_CONTROLLER_IMPL_ID} instanceId=${this.instanceId} reason=${reason}`,
    )
    this.pendingReasons.add(reason)
    console.info(`[InkChapter Numbering] OUTLINE-APPLY-SCHEDULE reason=${reason} pending=${this.pendingReasons.size}`)
    if (this.rafId !== null) return
    this.rafId = requestAnimationFrame(() => {
      this.rafId = null
      const reasons = [...this.pendingReasons]
      this.pendingReasons.clear()
      this.applyLatestSnapshot(reasons)
    })
  }

  /** Legacy entry points keep their signature but funnel into scheduleApply. */
  private applyOutlineFromCache(expectedVersion: number): void {
    if (expectedVersion !== this.getRenderVersion()) return
    this.scheduleApply('outline-apply-cache')
  }

  /**
   * Quiescence debounce: wait until the native outline mutation epoch is stable
   * for one RAF before applying. This prevents MODEL F — applying decoration
   * before Typora finishes its native subtree rebuild, which then wipes it.
   * Never uses a fixed setTimeout.
   */
  private schedulePostNativeApply(reason: string): void {
    this.nativeQuiescenceEpoch = this.nativeMutationEpoch
    if (this.nativeQuiescenceRafId !== null) return
    this.nativeQuiescenceRafId = requestAnimationFrame(() => {
      this.nativeQuiescenceRafId = null
      if (this.nativeMutationEpoch === this.nativeQuiescenceEpoch) {
        // Stable for one full RAF → safe to apply latest snapshot.
        this.scheduleApply(reason)
      } else {
        // More native mutations arrived during this frame → wait another frame.
        this.schedulePostNativeApply(reason)
      }
    })
  }

  /** Sample native outline item count + stable fingerprints (decoration-stripped). */
  private sampleNativeOutline(root: HTMLElement): { itemCount: number; textFingerprint: string; structureFingerprint: string } {
    const items = findOutlineTextElements(root)
    const texts: string[] = []
    const structs: string[] = []
    items.forEach((el, i) => {
      const text = (el.textContent ?? '').replace(/\s+/g, ' ').trim()
      const href = el.getAttribute('href') ?? el.closest('a')?.getAttribute('href') ?? ''
      texts.push(`${i}|${text}`)
      structs.push(`${i}|${el.tagName}|${href}`)
    })
    const sampled = {
      itemCount: items.length,
      textFingerprint: hashFingerprint(texts.join('\n')),
      structureFingerprint: hashFingerprint(structs.join('\n')),
    }

    // Fingerprint/epoch cross-check: if native content changed but the observer
    // never reported a native mutation, the observer has a coverage gap.
    const prevText = this.nativeTextFingerprint
    const prevStruct = this.nativeStructureFingerprint
    const hasPrev = prevText !== '' || prevStruct !== ''
    const changed = hasPrev && (sampled.textFingerprint !== prevText || sampled.structureFingerprint !== prevStruct)
    if (changed && this.nativeMutationEpoch === this.lastSampleEpoch) {
      console.info(
        `[InkChapter Numbering] OUTLINE-OBSERVER-COVERAGE-GAP previousFingerprint=${prevText}/${prevStruct} ` +
        `currentFingerprint=${sampled.textFingerprint}/${sampled.structureFingerprint} ` +
        `previousEpoch=${this.lastSampleEpoch} currentEpoch=${this.nativeMutationEpoch} ` +
        `decision=FAIL reason=FINGERPRINT_CHANGED_WITHOUT_MUTATION_EVENT`,
      )
    }
    this.lastSampleEpoch = this.nativeMutationEpoch

    this.nativeItemCount = sampled.itemCount
    this.nativeTextFingerprint = sampled.textFingerprint
    this.nativeStructureFingerprint = sampled.structureFingerprint
    return sampled
  }

  /** Remove stale decorations on elements no longer in the matched set. */
  private removeStaleDecorations(root: HTMLElement, matchedElements: Set<HTMLElement>): number {
    let removed = 0
    const decorated = root.querySelectorAll<HTMLElement>('[data-inkchapter-number]')
    decorated.forEach(el => {
      if (!matchedElements.has(el)) {
        el.removeAttribute('data-inkchapter-number')
        el.removeAttribute('data-inkchapter-number-gap')
        removed++
      }
    })
    return removed
  }

  /** Apply the latest snapshot against the CURRENT VISIBLE outline root (idempotent). */
  private applyLatestSnapshot(reasons: string[]): void {
    console.info(
      `[InkChapter Numbering] OUTLINE-CODEPATH-MARKER site=APPLY_LATEST_SNAPSHOT ` +
      `implId=${OUTLINE_CONTROLLER_IMPL_ID} instanceId=${this.instanceId} revision=${this.cache.revision}`,
    )
    if (this.isWriting) return

    const expectedDocKey = this.currentDocumentKey
    const expectedRevision = this.cache.revision

    if (this.cache.documentKey !== expectedDocKey && expectedDocKey !== '') {
      console.info('[InkChapter Numbering] OUTLINE-APPLY decision=SKIP_STALE_TASK reason=DOCUMENT_KEY_MISMATCH')
      return
    }
    if (this.cache.headings.length === 0) return

    // Formal apply ONLY to the CURRENT VISIBLE outline root (relaxed root is
    // for observer lifecycle only, never a formal render PASS).
    const root = findOutlineRoot()
    if (!root) {
      // DEFER (not terminal SKIP): keep the latest snapshot pending and register
      // a Root Availability Watch so a later root create/visible auto-wakes apply.
      this.pendingForVisibleRoot = true
      this.pendingDocumentKey = expectedDocKey
      this.pendingRevision = expectedRevision
      this.lastAvailabilityReason = 'NO_VISIBLE_OUTLINE_ROOT'
      console.info(
        `[InkChapter Numbering] OUTLINE-ROOT-WAIT documentKey=${expectedDocKey} revision=${expectedRevision} ` +
        `decision=DEFER reason=NO_VISIBLE_OUTLINE_ROOT`,
      )
      this.ensureRootAvailabilityWatch()
      return
    }
    // Root became available — clear pending state.
    if (this.pendingForVisibleRoot) {
      console.info(
        `[InkChapter Numbering] OUTLINE-ROOT-AVAILABLE documentKey=${expectedDocKey} revision=${expectedRevision} ` +
        `decision=CONSUME_LATEST reason=VISIBLE_ROOT_RESOLVED`,
      )
      this.pendingForVisibleRoot = false
      this.pendingDocumentKey = ''
      this.pendingRevision = 0
    }
    const weakMapRootToken = getRootToken(root)
    console.info(
      `[InkChapter Numbering] OUTLINE-ROOT-RESOLVE implId=${OUTLINE_CONTROLLER_IMPL_ID} ` +
      `instanceId=${this.instanceId} codepathRevision=v26 found=true connected=${root.isConnected} visible=true ` +
      `rootToken=${this.rootToken} weakMapRootToken=${weakMapRootToken} ` +
      `rootGeneration=${this.rootGeneration} identity=${root.tagName}#${root.id || '?'}`,
    )

    // Apply-before-use: defensively ensure the observer is bound to this root
    // before writing decorations (last-resort recovery if earlier binds DEFERed).
    const bindResult = this.ensureObserverBoundToCurrentRoot('apply-before-use')
    const applyRootToken = weakMapRootToken
    const observedRootTokenNow = this.observedRootToken
    const observerPresent = !!this.observer && this.isObserverActive
    const invariantPass = observerPresent && this.observedRootToken === applyRootToken && this.observerRoot === root
    console.info(
      `[InkChapter Numbering] OUTLINE-OBSERVER-APPLY-INVARIANT documentKey=${expectedDocKey} revision=${expectedRevision} ` +
      `rootToken=${applyRootToken} observedRootToken=${observedRootTokenNow} rootSame=${this.observerRoot === root} ` +
      `observerPresent=${observerPresent} observerGeneration=${this.observerGeneration} selfTestPassed=${this.selfTestPassed} ` +
      `decision=${invariantPass ? 'PASS' : 'FAIL'} reason=${bindResult.decision}`,
    )

    // Establish the apply transaction bound to this root node + generation.
    const transactionId = `tx-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`
    this.lastApplyTransaction = {
      transactionId,
      documentKey: expectedDocKey,
      snapshotRevision: expectedRevision,
      root,
      rootToken: this.rootToken,
      rootGeneration: this.rootGeneration,
    }

    // Record the native subtree generation at apply so the post-apply stability
    // barrier can detect a subsequent Typora native rebuild (MODEL F).
    const nativeAtApply = this.sampleNativeOutline(root)
    this.postApplyEpochAtApply = this.nativeMutationEpoch
    this.postApplyGenerationAtApply = this.nativeSubtreeGeneration
    console.info(
      `[InkChapter Numbering] OUTLINE-APPLY-BEGIN documentKey=${expectedDocKey} revision=${expectedRevision} ` +
      `transactionId=${transactionId} rootToken=${this.rootToken} nativeMutationEpoch=${this.nativeMutationEpoch} ` +
      `nativeSubtreeGeneration=${this.nativeSubtreeGeneration} nativeItemCount=${nativeAtApply.itemCount} ` +
      `textFingerprint=${nativeAtApply.textFingerprint} structureFingerprint=${nativeAtApply.structureFingerprint}`,
    )

    this.isWriting = true
    try {
      const items = findOutlineTextElements(root)
      const matches = matchHeadingsToOutline(this.cache.headings, this.cache.labels, items)
      const attrResult = applyNumberingAttributes(matches.map((m, i) => ({
        element: m.element,
        label: m.label,
        labelGap: this.cache.labelGaps[i] ?? '',
      })))
      syncOutlineNumberBoldStyle()

      // Stale decoration cleanup: remove decorations on native items that are no
      // longer part of the matched set (e.g. a heading was deleted).
      const matchedSet = new Set(matches.map(m => m.element))
      const staleRemoved = this.removeStaleDecorations(root, matchedSet)

      const expectedNumbered = this.cache.labels.filter(l => l !== '').length
      const actualDecorations = root.querySelectorAll<HTMLElement>('[data-inkchapter-number]').length
      const unmatchedHeading = Math.max(0, this.cache.headings.length - matches.length)
      const unmatchedOutline = Math.max(0, items.length - matches.length)
      const staleDecorationCount = Math.max(0, actualDecorations - expectedNumbered)

      this.lastApply = {
        matchedCount: matches.length,
        appliedCount: attrResult.applied + attrResult.updated,
        unmatchedCount: unmatchedHeading,
        unmatchedOutlineCount: unmatchedOutline,
        staleDecorationCount,
        reason: reasons.join('+'),
      }

      // Decoration loss watchdog state.
      this.lastAppliedDecorationCount = actualDecorations
      this.lastAppliedRevision = expectedRevision
      this.lastAppliedRootToken = this.rootToken

      console.info(
        `[InkChapter Numbering] OUTLINE-APPLY documentKey=${expectedDocKey} revision=${expectedRevision} ` +
        `transactionId=${transactionId} rootToken=${this.rootToken} rootGeneration=${this.rootGeneration} ` +
        `reasons=${reasons.join('+')} rootConnected=${root.isConnected} headingCount=${this.cache.headings.length} ` +
        `matchedCount=${matches.length} createdCount=${attrResult.applied + attrResult.updated} ` +
        `updatedCount=${attrResult.updated} removedCount=${staleRemoved} ` +
        `unmatchedHeadingCount=${unmatchedHeading} unmatchedOutlineCount=${unmatchedOutline} ` +
        `staleDecorationCount=${staleDecorationCount}`,
      )

      // Decoration-loss repair: expected numbered > 0 but decorations dropped to 0.
      if (expectedNumbered > 0 && actualDecorations === 0) {
        console.info(`[InkChapter Numbering] OUTLINE-DECORATION-LOSS-DETECT expected=${expectedNumbered} actual=${actualDecorations} decision=REPAIR`)
        const attempts = this.verifyRepairByRevision.get(expectedRevision) ?? 0
        if (attempts < 1) {
          this.verifyRepairByRevision.set(expectedRevision, attempts + 1)
          this.scheduleApply('outline-decoration-lost')
        }
      }
    } finally {
      this.isWriting = false
    }

    this.scheduleVerify(expectedDocKey, expectedRevision)
  }

  private scheduleVerify(docKey: string, revision: number): void {
    if (this.verifyRafId !== null) return
    this.verifyRafId = requestAnimationFrame(() => {
      this.verifyRafId = null
      this.verifyOutline(docKey, revision)
    })
  }

  /**
   * Register a Root Availability Watch when the visible outline root is
   * missing/hidden. Uses the stable sidebar host observer (already bound) plus a
   * ResizeObserver on the hidden candidate root to detect false→true visibility
   * transition. Never re-computes headings — only consumes the latest snapshot.
   */
  private ensureRootAvailabilityWatch(): void {
    const candidate = findOutlineRootRelaxed()
    this.availabilityCandidateFound = !!candidate
    this.availabilityCandidateConnected = candidate ? candidate.isConnected : false
    this.availabilityCandidateVisible = candidate ? candidate.offsetParent !== null : false
    this.lastAvailabilityReason = 'NO_VISIBLE_OUTLINE_ROOT'
    console.info(
      `[InkChapter Numbering] OUTLINE-ROOT-CANDIDATE found=${!!candidate} ` +
      `connected=${this.availabilityCandidateConnected} visible=${this.availabilityCandidateVisible}`,
    )

    // Root available (even hidden) → late-bind the observer now, before it
    // becomes visible. Observer bind only needs connected, not visible.
    if (candidate && candidate.isConnected) {
      this.ensureObserverBoundToCurrentRoot('root-available')
    }

    if (candidate && typeof ResizeObserver !== 'undefined' && !this.resizeObserver) {
      this.resizeObserver = new ResizeObserver(() => {
        const nowVisible = findOutlineRoot()
        this.availabilityCandidateVisible = !!nowVisible
        console.info(
          `[InkChapter Numbering] OUTLINE-ROOT-VISIBILITY visible=${!!nowVisible} ` +
          `transition=${this.availabilityCandidateVisible ? 'true' : 'false'}`,
        )
        if (nowVisible) {
          this.stopAvailabilityWatch()
          // Late-bind before apply: visibility transition must ensure the
          // observer is bound to the now-visible root first.
          this.ensureObserverBoundToCurrentRoot('root-became-visible')
          this.scheduleApply('outline-root-became-visible')
        }
      })
      this.resizeObserver.observe(candidate)
    }
  }

  private stopAvailabilityWatch(): void {
    if (this.resizeObserver) {
      this.resizeObserver.disconnect()
      this.resizeObserver = null
    }
  }

  private verifyOutline(docKey: string, revision: number): void {
    if (docKey !== this.currentDocumentKey) return
    if (revision !== this.cache.revision) return

    const tx = this.lastApplyTransaction
    const currentRoot = findOutlineRoot() // visible only — NEVER global document.querySelectorAll

    const expectedNumbered = this.cache.labels.filter(l => l !== '').length
    const actualDecorations = currentRoot
      ? currentRoot.querySelectorAll<HTMLElement>('[data-inkchapter-number]').length
      : 0
    const staleDecorationCount = Math.max(0, actualDecorations - expectedNumbered)

    const rootSame = !!tx && !!currentRoot && tx.root === currentRoot
    const rootGenerationSame = !!tx && tx.rootGeneration === this.rootGeneration
    const rootTokenSame = !!tx && tx.rootToken === this.rootToken
    const rootConnected = !!currentRoot && currentRoot.isConnected
    const rootVisible = !!currentRoot && currentRoot.offsetParent !== null

    // MODEL F: detect whether Typora mutated the native subtree AFTER InkChapter
    // wrote decorations (which would invalidate this transaction's verify).
    const nativeEpochChangedAfterApply = this.nativeMutationEpoch !== this.postApplyEpochAtApply
    const nativeGenerationChangedAfterApply = this.nativeSubtreeGeneration !== this.postApplyGenerationAtApply

    let decision: 'PASS' | 'FAIL' | 'RETRY'
    let reason: string

    if (!tx) {
      decision = 'FAIL'; reason = 'NO_APPLY_TRANSACTION'
    } else if (expectedNumbered === 0) {
      decision = 'PASS'; reason = 'NO_NUMBERED_HEADINGS'
    } else if (!rootSame || !rootGenerationSame || !rootTokenSame) {
      decision = 'RETRY'; reason = 'ROOT_REPLACED_AFTER_APPLY'
    } else if (!rootConnected || !rootVisible) {
      decision = 'FAIL'; reason = 'ROOT_NOT_VISIBLE'
    } else if (actualDecorations !== expectedNumbered) {
      // Strict equality: actual > expected (stale) is ALSO a FAIL, never PASS.
      decision = 'FAIL'; reason = 'DECORATION_COUNT_MISMATCH'
    } else if (staleDecorationCount > 0) {
      decision = 'FAIL'; reason = 'STALE_DECORATION_PRESENT'
    } else if ((this.lastApply?.unmatchedCount ?? 0) > 0) {
      decision = 'FAIL'; reason = 'UNMATCHED_HEADING_PRESENT'
    } else if ((this.lastApply?.unmatchedOutlineCount ?? 0) > 0) {
      decision = 'FAIL'; reason = 'UNMATCHED_OUTLINE_PRESENT'
    } else if (nativeEpochChangedAfterApply || nativeGenerationChangedAfterApply) {
      // Post-apply stability barrier: Typora rebuilt native items after apply.
      decision = 'RETRY'; reason = 'NATIVE_OUTLINE_MUTATED_AFTER_APPLY'
    } else {
      decision = 'PASS'; reason = 'OK'
    }

    this.lastVerify = { expectedCount: expectedNumbered, actualCount: actualDecorations, decision }

    console.info(
      `[InkChapter Numbering] OUTLINE-VERIFY documentKey=${docKey} revision=${revision} ` +
      `expectedNumberedCount=${expectedNumbered} actualNumberDecorationCount=${actualDecorations} ` +
      `rootConnected=${rootConnected} rootVisible=${rootVisible} rootSame=${rootSame} ` +
      `rootGenerationSame=${rootGenerationSame} rootTokenSame=${rootTokenSame} decision=${decision} reason=${reason}`,
    )
    console.info(
      `[InkChapter Numbering] OUTLINE-STRICT-VERIFY documentKey=${docKey} revision=${revision} ` +
      `expectedNumberedCount=${expectedNumbered} actualNumberDecorationCount=${actualDecorations} ` +
      `matchedCount=${this.lastApply?.matchedCount ?? 0} ` +
      `unmatchedHeadingCount=${this.lastApply?.unmatchedCount ?? 0} ` +
      `unmatchedOutlineCount=${this.lastApply?.unmatchedOutlineCount ?? 0} ` +
      `staleDecorationCount=${staleDecorationCount} ` +
      `nativeEpochChangedAfterApply=${nativeEpochChangedAfterApply} ` +
      `nativeGenerationChangedAfterApply=${nativeGenerationChangedAfterApply} ` +
      `decision=${decision} reason=${reason}`,
    )

    if (decision === 'RETRY') {
      if (reason === 'NATIVE_OUTLINE_MUTATED_AFTER_APPLY') {
        // MODEL F repair: wait for the native rebuild to settle, then re-apply.
        console.info(
          `[InkChapter Numbering] OUTLINE-REPAIR-SCHEDULE documentKey=${docKey} revision=${revision} ` +
          `reason=native-outline-rebuilt-after-apply`,
        )
        this.schedulePostNativeApply('outline-native-rebuilt-after-apply')
      } else {
        // rootSame=false must NEVER pass — rebind the new root and reapply latest.
        this.ensureObserverBoundToCurrentRoot('root-replaced')
        this.scheduleApply('outline-root-replaced')
      }
    }
  }

  // ── Observer ──────────────────────────────────────

  private ensureObserverBoundToCurrentRoot(reason: string): { decision: 'BOUND' | 'REBOUND' | 'NO_OP' | 'DEFER'; rootToken: number | null } {
    console.info(
      `[InkChapter Numbering] OUTLINE-CODEPATH-MARKER site=OBSERVER_BIND_ENTRY ` +
      `implId=${OUTLINE_CONTROLLER_IMPL_ID} instanceId=${this.instanceId} reason=${reason} documentKey=${this.currentDocumentKey}`,
    )

    const root = findOutlineRoot() ?? findOutlineRootRelaxed()
    if (!root || !root.isConnected) {
      console.info(
        `[InkChapter Numbering] OUTLINE-OBSERVER-BIND-DECISION reason=${reason} decision=DEFER cause=NO_CONNECTED_ROOT`,
      )
      return { decision: 'DEFER', rootToken: null }
    }

    // Real DOM node identity via WeakMap (rootToken must never stay 0).
    const newRootToken = getRootToken(root)

    // Idempotent: already bound to the SAME root node → NO_OP (no observer churn).
    if (this.observer && this.observerRoot === root && this.observedRootToken === newRootToken && this.isObserverActive) {
      console.info(
        `[InkChapter Numbering] OUTLINE-OBSERVER-BIND-DECISION reason=${reason} decision=NO_OP ` +
        `rootToken=${newRootToken} cause=ALREADY_BOUND_CURRENT_ROOT`,
      )
      return { decision: 'NO_OP', rootToken: newRootToken }
    }

    // Rebind: disconnect old (if any), then bind the current root.
    const oldRootToken = this.observedRootToken
    this.detachObserver()

    const currentResolvedToken = getRootToken(findOutlineRoot())
    const sameResolvedRoot = currentResolvedToken === newRootToken

    this.observerBindCount++
    this.observerGeneration++
    this.rootGeneration++
    this.rootToken = newRootToken
    this.observedRootToken = newRootToken
    this.observerBoundaryLevel = 'L0'
    this.probeAddedSeen = false
    this.probeRemovedSeen = false

    console.info(
      `[InkChapter Numbering] OUTLINE-OBSERVER-LIFECYCLE action=${oldRootToken === null ? 'BIND' : 'REBIND'} ` +
      `observerGeneration=${this.observerGeneration} oldRootToken=${oldRootToken} newRootToken=${newRootToken} ` +
      `reason=${reason} documentKey=${this.currentDocumentKey}`,
    )
    console.info(
      `[InkChapter Numbering] OUTLINE-ROOT-IDENTITY resolved=${!!newRootToken} rootToken=${newRootToken} ` +
      `identity=${root.tagName}#${root.id || '?'} connected=${root.isConnected} sameAsObservedRoot=${sameResolvedRoot}`,
    )
    this.recordEvent('outline:observer-bind', {
      headingCount: this.cache.headings.length,
      labelCount: this.cache.labels.length,
      matchedCount: 0, appliedCount: 0,
    })

    this.observerRoot = root
    this.observer = new MutationObserver((mutations) => {
      // ── Unconditional callback entry log (even if everything is IGNORED) ──
      this.callbackCount++
      this.rawMutationRecordCount += mutations.length
      console.info(
        `[InkChapter Numbering] OUTLINE-OBSERVER-CALLBACK observerGeneration=${this.observerGeneration} ` +
        `recordCount=${mutations.length} observedRootConnected=${this.observerRoot?.isConnected ?? false} ` +
        `currentResolvedRootToken=${getRootToken(findOutlineRoot())} observedRootToken=${this.observedRootToken} ` +
        `sameRoot=${getRootToken(findOutlineRoot()) === this.observedRootToken}`,
      )

      let nativeChange = false
      let classOnlyChange = false
      let structuralNativeChange = false
      let nativeMutationCount = 0
      let addedNativeItemCount = 0
      let removedNativeItemCount = 0

      for (let ri = 0; ri < mutations.length; ri++) {
        const m = mutations[ri]
        const target = m.target

        // ── RAW mutation record (BEFORE any classification / early-return) ──
        const containsInkChapterAdded = Array.from(m.addedNodes).some(n => isInkChapterOwnedNode(n))
        const containsInkChapterRemoved = Array.from(m.removedNodes).some(n => isInkChapterOwnedNode(n))
        const containsNative = containsNativeOutlineNode(m.addedNodes) || containsNativeOutlineNode(m.removedNodes)
        const addedFingerprint = Array.from(m.addedNodes).map(nodeIdentityFingerprint).slice(0, 6).join(',')
        const removedFingerprint = Array.from(m.removedNodes).map(nodeIdentityFingerprint).slice(0, 6).join(',')
        console.info(
          `[InkChapter Numbering] OUTLINE-MUTATION-RAW observerGeneration=${this.observerGeneration} ` +
          `observedBoundary=${this.observerBoundaryLevel} rootToken=${this.observedRootToken} recordIndex=${ri} type=${m.type} ` +
          `targetTag=${target instanceof HTMLElement ? target.tagName : 'Text'} ` +
          `targetId=${target instanceof HTMLElement ? (target.id || '') : ''} ` +
          `targetClass=${target instanceof HTMLElement ? (target.className || '').split(' ').slice(0, 2).join('.') : ''} ` +
          `targetConnected=${target instanceof HTMLElement ? target.isConnected : false} ` +
          `addedNodeCount=${m.addedNodes.length} removedNodeCount=${m.removedNodes.length} attributeName=${m.attributeName ?? ''} ` +
          `containsInkChapterAddedNode=${containsInkChapterAdded} containsInkChapterRemovedNode=${containsInkChapterRemoved} ` +
          `containsNativeOutlineNode=${containsNative} addedFingerprint=${addedFingerprint} removedFingerprint=${removedFingerprint} ` +
          `timestamp=${performance.now()}`,
        )

        // Track self-test probe visibility.
        for (let i = 0; i < m.addedNodes.length; i++) if (isObserverProbe(m.addedNodes[i])) this.probeAddedSeen = true
        for (let i = 0; i < m.removedNodes.length; i++) if (isObserverProbe(m.removedNodes[i])) this.probeRemovedSeen = true

        // ── Classification (strict SELF) ──
        if (m.type === 'characterData') {
          console.info('[InkChapter Numbering] OUTLINE-MUTATION-CLASSIFY source=TYPOGRAPHIC_NATIVE reason=NATIVE_TEXT_CHANGED')
          nativeChange = true
          nativeMutationCount++
          continue
        }

        if (m.type === 'childList') {
          const addedAllSelf = Array.from(m.addedNodes).every(n => isInkChapterOwnedNode(n))
          const removedAllSelf = Array.from(m.removedNodes).every(n => isInkChapterOwnedNode(n))
          const allSelf = addedAllSelf && removedAllSelf && (m.addedNodes.length + m.removedNodes.length) > 0
          if (allSelf) {
            this.lastInkchapterMutationAt = performance.now()
            console.info('[InkChapter Numbering] OUTLINE-MUTATION-CLASSIFY source=INKCHAPTER_SELF reason=DECORATION_ONLY')
            continue
          }
          // Native container removed WITH decoration inside → still NATIVE.
          const reason = (containsInkChapterAdded || containsInkChapterRemoved)
            ? 'NATIVE_CONTAINER_WITH_DECORATION'
            : 'NATIVE_ITEM_MUTATION'
          console.info(`[InkChapter Numbering] OUTLINE-MUTATION-CLASSIFY source=TYPOGRAPHIC_NATIVE reason=${reason}`)
          nativeChange = true
          structuralNativeChange = true
          nativeMutationCount++
          addedNativeItemCount += m.addedNodes.length
          removedNativeItemCount += m.removedNodes.length
          continue
        }

        if (m.type === 'attributes') {
          if (isApplyingOutlineBoldStyle) continue
          if (target instanceof HTMLElement && target.hasAttribute('data-inkchapter-number')) {
            this.lastInkchapterMutationAt = performance.now()
            console.info('[InkChapter Numbering] OUTLINE-MUTATION-CLASSIFY source=INKCHAPTER_SELF reason=DECORATION_ATTRIBUTE')
            continue
          }
          if (m.attributeName === 'class') classOnlyChange = true
        }
      }

      if (nativeChange) {
        this.nativeMutationEpoch++
        if (structuralNativeChange) this.nativeSubtreeGeneration++
        this.lastNativeMutationAt = performance.now()
        console.info(
          `[InkChapter Numbering] OUTLINE-NATIVE-SUBTREE-MUTATION documentKey=${this.currentDocumentKey} rootToken=${this.rootToken} ` +
          `source=TYPOGRAPHIC_NATIVE mutationCount=${nativeMutationCount} addedNativeItemCount=${addedNativeItemCount} ` +
          `removedNativeItemCount=${removedNativeItemCount} nativeMutationEpoch=${this.nativeMutationEpoch} ` +
          `nativeSubtreeGeneration=${this.nativeSubtreeGeneration} decision=TRACKED`,
        )
        this.schedulePostNativeApply('outline-native-mutation')
      } else if (classOnlyChange) {
        this.scheduleApply('outline-class-changed')
      }

      // Decoration loss watchdog: detect wiped decorations between applies.
      this.checkDecorationLoss()
    })

    this.observer.observe(root, {
      childList: true,
      subtree: true,
      characterData: true,
      attributes: true,
      attributeFilter: ['class', 'style', 'hidden', 'aria-hidden'],
      attributeOldValue: true,
    })
    this.isObserverActive = true

    console.info(
      `[InkChapter Numbering] OUTLINE-OBSERVER-BIND rootToken=${newRootToken} ` +
      `rootIdentity=${root.tagName}#${root.id || '?'} rootConnected=${root.isConnected} ` +
      `rootVisible=${root.offsetParent !== null} ` +
      `rootParentIdentity=${root.parentElement ? root.parentElement.tagName + '#' + (root.parentElement.id || '') : 'null'} ` +
      `documentContainsRoot=${document.contains(root)} observerGeneration=${this.observerGeneration} ` +
      `sameResolvedRoot=${sameResolvedRoot} decision=BOUND`,
    )

    // Self-test: prove the observer receives its own hidden probe mutations.
    this.runObserverSelfTest(root)

    // Immediately sync if we have cached data for current document
    if (this.cache.headings.length > 0 && this.cache.documentKey === this.currentDocumentKey) {
      this.applyOutlineFromCache(this.getRenderVersion())
    }

    return { decision: oldRootToken === null ? 'BOUND' : 'REBOUND', rootToken: newRootToken }
  }

  /** Insert/remove a hidden probe and verify the observer sees both mutations. */
  private runObserverSelfTest(root: HTMLElement): void {
    const probe = document.createElement('span')
    probe.setAttribute('data-inkchapter-outline-observer-probe', '1')
    probe.hidden = true
    probe.setAttribute('aria-hidden', 'true')

    this.probeAddedSeen = false
    this.probeRemovedSeen = false

    root.appendChild(probe)
    queueMicrotask(() => {
      probe.remove()
      queueMicrotask(() => {
        const passed = this.probeAddedSeen && this.probeRemovedSeen
        this.selfTestPassed = passed
        console.info(
          `[InkChapter Numbering] OUTLINE-OBSERVER-SELF-TEST rootToken=${this.observedRootToken} ` +
          `observerGeneration=${this.observerGeneration} probeAddedSeen=${this.probeAddedSeen} ` +
          `probeRemovedSeen=${this.probeRemovedSeen} callbackCount=${this.callbackCount} ` +
          `decision=${passed ? 'PASS' : 'FAIL'} reason=${passed ? 'probe-add-remove-observed' : 'observer-not-receiving-probe-mutations'}`,
        )
      })
    })
  }

  /** Decoration loss watchdog: fire if decorations dropped below the last apply. */
  private checkDecorationLoss(): void {
    if (this.lastAppliedDecorationCount === 0) return
    const root = findOutlineRoot()
    if (!root) return
    const current = root.querySelectorAll<HTMLElement>('[data-inkchapter-number]').length
    const expected = this.cache.labels.filter(l => l !== '').length
    if (current < expected && current < this.lastAppliedDecorationCount) {
      console.info(
        `[InkChapter Numbering] OUTLINE-DECORATION-LOSS documentKey=${this.currentDocumentKey} ` +
        `revision=${this.lastAppliedRevision} expected=${expected} before=${this.lastAppliedDecorationCount} ` +
        `after=${current} rootToken=${this.lastAppliedRootToken} observerBoundary=${this.observerBoundaryLevel} ` +
        `nativeMutationEpoch=${this.nativeMutationEpoch} decision=DETECTED`,
      )
    }
  }

  private detachObserver(): void {
    if (this.observer) {
      this.observer.disconnect()
      this.observer = null
      this.observerDisconnectCount++
      console.info(
        `[InkChapter Numbering] OUTLINE-OBSERVER-LIFECYCLE action=DISCONNECT observerGeneration=${this.observerGeneration} ` +
        `rootToken=${this.observedRootToken} reason=detach-observer`,
      )
    }
    this.observerRoot = null
    this.isObserverActive = false
    this.rootToken = null
  }

  // ── Event chain logging ──────────────────────────

  /** Record a structured event for the event chain audit. */
  private recordEvent(
    event: string,
    counts: {
      headingCount: number
      labelCount: number
      matchedCount: number
      appliedCount: number
    },
  ): void {
    this.eventSeq++
    const root = findOutlineRoot()
    const rootRelaxed = root ? root : findOutlineRootRelaxed()

    const entry: EventChainEntry = {
      seq: this.eventSeq,
      time: performance.now(),
      event,
      documentKey: this.currentDocumentKey || '(empty)',
      renderVersion: this.renderVersion,
      cacheRevision: this.cache.revision,
      outlineRootExists: root !== null || rootRelaxed !== null,
      outlineRootSelector: root
        ? `${root.tagName}#${root.id || '?'}.${(root.className || '?').split(' ')[0]}`
        : rootRelaxed
          ? `[relaxed]${rootRelaxed.tagName}#${rootRelaxed.id || '?'}`
          : null,
      headingCount: counts.headingCount,
      labelCount: counts.labelCount,
      matchedCount: counts.matchedCount,
      appliedCount: counts.appliedCount,
    }

    recordRuntimeAudit(event, {
      headingCount: counts.headingCount,
      labelCount: counts.labelCount,
      matchedCount: counts.matchedCount,
      appliedCount: counts.appliedCount,
      documentKey: entry.documentKey,
      renderVersion: entry.renderVersion,
      details: entry as unknown as Record<string, unknown>,
    })

    // Log to console for real-time debugging
    const rootStatus = entry.outlineRootExists
      ? `root=${entry.outlineRootSelector}`
      : 'root=NONE'
    EVT_LOG(
      `[InkChapter EVT] seq=${entry.seq} time=${entry.time.toFixed(0)} ${event} ` +
      `doc=${entry.documentKey.slice(0, 20)} rv=${entry.renderVersion} cr=${entry.cacheRevision} ` +
      `${rootStatus} h=${entry.headingCount} l=${entry.labelCount} ` +
      `m=${entry.matchedCount} a=${entry.appliedCount}`,
    )
  }

  /** Dump event chain summary to console. */
  dumpEventChain(): void {
    EVT_LOG(`[InkChapter OUTLINE] observerBindCount=${this.observerBindCount} observerDisconnectCount=${this.observerDisconnectCount}`)
  }

  /** Public accessor so the service can compose the full document-identity probe. */
  getSyncProbe(): Record<string, unknown> {
    return this.outlineSyncProbe()
  }

  /** Register the DevTools diagnostic probe. */
  private registerProbe(): void {
    try {
      ;(window as any).__inkchapter_outline_sync_probe__ = () => this.outlineSyncProbe()
    } catch { /* ignore */ }
  }

  /** Diagnostic probe exposing snapshot/root/observer/apply/verify state. */
  private outlineSyncProbe(): Record<string, unknown> {
    const currentVisibleRoot = findOutlineRoot()
    return {
      controllerDocumentKey: this.currentDocumentKey,
      snapshotDocumentKey: this.cache.documentKey,
      snapshotRevision: this.cache.revision,
      headingCount: this.cache.headings.length,
      labelCount: this.cache.labels.length,
      rootGeneration: this.rootGeneration,
      boundRootToken: this.rootToken,
      boundRoot: this.observerRoot ? `${this.observerRoot.tagName}#${this.observerRoot.id || '?'}` : null,
      currentVisibleRoot: currentVisibleRoot ? `${currentVisibleRoot.tagName}#${currentVisibleRoot.id || '?'}` : null,
      sameNode: !!currentVisibleRoot && currentVisibleRoot === this.observerRoot,
      rootConnected: currentVisibleRoot ? currentVisibleRoot.isConnected : false,
      rootVisible: currentVisibleRoot ? currentVisibleRoot.offsetParent !== null : false,
      observer: {
        hostBound: !!this.sidebarHostObserver,
        rootBound: !!this.observer && this.isObserverActive,
        observerGeneration: this.observerGeneration,
        boundaryLevel: this.observerBoundaryLevel,
        observedRootToken: this.observedRootToken,
        callbackCount: this.callbackCount,
        rawMutationRecordCount: this.rawMutationRecordCount,
        selfTestPassed: this.selfTestPassed,
        probeAddedSeen: this.probeAddedSeen,
        probeRemovedSeen: this.probeRemovedSeen,
      },
      render: {
        renderVersion: this.renderVersion,
        pendingRaf: this.rafId !== null,
        pendingReasons: [...this.pendingReasons],
      },
      dom: {
        outlineItemCount: currentVisibleRoot ? findOutlineTextElements(currentVisibleRoot).length : 0,
        actualDecorationCountInCurrentVisibleRoot: currentVisibleRoot
          ? currentVisibleRoot.querySelectorAll('[data-inkchapter-number]').length
          : 0,
      },
      lastApplyTransaction: this.lastApplyTransaction
        ? {
            transactionId: this.lastApplyTransaction.transactionId,
            documentKey: this.lastApplyTransaction.documentKey,
            snapshotRevision: this.lastApplyTransaction.snapshotRevision,
            rootToken: this.lastApplyTransaction.rootToken,
            rootGeneration: this.lastApplyTransaction.rootGeneration,
          }
        : null,
      lastApply: this.lastApply,
      lastVerify: this.lastVerify,
      waiting: this.pendingForVisibleRoot,
      pendingDocumentKey: this.pendingDocumentKey,
      pendingRevision: this.pendingRevision,
      hostObserverBound: !!this.sidebarHostObserver,
      candidateFound: this.availabilityCandidateFound,
      candidateConnected: this.availabilityCandidateConnected,
      candidateVisible: this.availabilityCandidateVisible,
      resizeObserverBound: !!this.resizeObserver,
      lastAvailabilityReason: this.lastAvailabilityReason,
      nativeMutationEpoch: this.nativeMutationEpoch,
      nativeSubtreeGeneration: this.nativeSubtreeGeneration,
      nativeItemCount: this.nativeItemCount,
      nativeTextFingerprint: this.nativeTextFingerprint,
      nativeStructureFingerprint: this.nativeStructureFingerprint,
      lastNativeMutationAt: this.lastNativeMutationAt,
      lastInkchapterMutationAt: this.lastInkchapterMutationAt,
      postApplyEpochAtApply: this.postApplyEpochAtApply,
      postApplyGenerationAtApply: this.postApplyGenerationAtApply,
    }
  }
}
