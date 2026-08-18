/**
 * Outline Numbering Controller v29 — Current-Document Full Resync.
 *
 * MODEL K: current Markdown headings are the sole business authority; the
 * native outline is read-only input; InkChapter numbering is a rebuildable
 * derived view. EVENT → DIRTY → CURRENT-DOCUMENT-READINESS → FULL RESYNC →
 * VERIFY → CLEAN. The v28 semantic fingerprint is diagnostic-only and never
 * blocks a full resync when the mature matcher reports a complete match.
 */

import {
  findOutlineRoot,
  findOutlineRootRelaxed,
  findOutlineTextElements,
  findOutlineNativeItems,
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

/** Result of a semantic convergence evaluation (v28 MODEL_J). */
interface SemanticConvergenceResult {
  documentKey: string
  revision: number
  rootToken: number | null
  convergenceTxnId: number
  headingCount: number
  nativeItemCount: number
  matchedCount: number
  unmatchedHeadingCount: number
  unmatchedOutlineCount: number
  headingSemanticFingerprint: string
  nativeSemanticFingerprint: string
  temporalStable: boolean
  semanticReady: boolean
  /** v29: matcher-ready but fingerprint differs → diagnostic only, never blocks. */
  fingerprintMismatch: boolean
  decision: 'PASS' | 'WAIT_OR_REFRESH'
  reason: string
}

/** Unified outline dirty trigger (v29 MODEL_K). */
type OutlineDirtyReason =
  | 'startup'
  | 'document-switch'
  | 'heading-structure-change'
  | 'heading-snapshot-change'
  | 'native-subtree-rebuild'
  | 'decoration-loss'
  | 'outline-root-replacement'
  | 'outline-became-visible'
  | 'document-context-ready'
  | 'verify-repair'

const SIDEBAR_HOST_SELECTORS = [
  '#typora-sidebar',
  '.typora-sidebar',
  '.sidebar-content',
  '#sidebar-content',
]

/** Build marker for diagnostics. */
const CONTROLLER_BUILD_MARKER = 'inkchapter-outline-current-document-full-resync-v29'

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

// ── Semantic convergence helpers (v28 MODEL J) ─────────────────────
// DOM root identity (rootToken) is NOT the same as document content ownership.
// The semantic sequence captures heading level + normalized text + occurrence
// ordinal, so H2→H3 (same text) changes the fingerprint and duplicate headings
// are disambiguated by occurrence.

function normalizeOutlineText(text: string): string {
  return text.replace(/\s+/g, ' ').trim()
}

export interface SemanticSequenceItem { level: number; text: string }

/** Occurrence-aware semantic sequence (level + normalized text + ordinal). */
export function buildSemanticSequence(items: readonly SemanticSequenceItem[]): string[] {
  const occurrence = new Map<string, number>()
  return items.map(it => {
    const key = `${it.level}|${it.text}`
    const n = (occurrence.get(key) ?? 0) + 1
    occurrence.set(key, n)
    return `${it.level}|${it.text}|${n}`
  })
}

/** Maximum number of native-refresh recovery attempts before terminal evidence. */
const MAX_NATIVE_REFRESH_ATTEMPTS = 3

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

// ── Code path authority (v29) ──────────────────────────────────────
const OUTLINE_CONTROLLER_IMPL_ID = 'outline-controller-current-document-full-resync-v29-A'
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
    duplicateDecorationCount: number
    orphanDecorationCount: number
    labelMismatchCount: number
    headingCount: number
    reason: string
  } | null = null
  private lastVerify: { expectedCount: number; actualCount: number; decision: string; phase: string } | null = null

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

  // ── Native stability state (v27 MODEL_I_POST_NATIVE_STABILITY) ──
  // Native mutation → nativeDirty → quiescence (event-driven) → latest apply
  // → post-apply watch → stable verify. Fixed timeouts are NEVER a gate.
  private nativeDirty = false
  private repairRequired = false
  private nativeStabilityCheckGeneration = 0
  private nativeStabilityInFlight = false
  private lastNativeMutationAtRevision: number | null = null
  private lastNativeMutationRootToken: number | null = null
  private pendingPostNativeApplyRevision: number | null = null

  // Post-apply stability watch (cross MutationObserver delivery + RAF).
  private postApplyWatchActive = false
  private postApplyWatchEpoch = 0
  private postApplyWatchGeneration = 0
  private postApplyWatchRevision = 0

  // Coverage-gap pending-delivery two-phase state.
  private pendingCoverageGap: {
    documentKey: string
    rootToken: number | null
    epochAtSample: number
    textFingerprint: string
    structureFingerprint: string
  } | null = null

  // ── Stability statistics (acceptance metrics) ──
  private nativeMutationCount = 0
  private nativeBurstCount = 0
  private postNativeApplyCount = 0
  private repairScheduleCount = 0
  private postApplyInvalidationCount = 0
  private coverageGapPendingCount = 0
  private coverageGapResolvedCount = 0
  private coverageGapFailCount = 0
  private immediateVerifyFailCount = 0
  private stableVerifyFailCount = 0
  private finalDecorationLossCount = 0

  // v29 full-resync acceptance metrics.
  private dirtyMarkCount = 0
  private readinessReadyCount = 0
  private readinessWaitCount = 0
  private fullResyncBeginCount = 0
  private fullResyncPassCount = 0
  private fullResyncFailCount = 0
  private staleDocumentDropCount = 0
  private staleRootDropCount = 0
  private semanticDiagnosticMismatchCount = 0

  // ── v29 MODEL_K: unified dirty → readiness → full resync → verify → clean ──
  private outlineDirty = true
  private outlineDirtyReason: OutlineDirtyReason | null = 'startup'
  private fullResyncGeneration = 0
  private lastReadiness: SemanticConvergenceResult | null = null

  // ── v28 content ownership (downgraded to forensic/diagnostic only) ──
  private outlineContentDocumentKey: string | null = null
  private outlineContentGeneration = 0
  private documentSwitchConvergencePending = false
  private convergenceTargetDocumentKey: string | null = null
  private convergenceTargetRevision: number | null = null
  private convergenceTxnId = 0
  private nativeRefreshAttempts = 0
  private nativeRefreshGeneration = 0
  private lastSemanticResult: SemanticConvergenceResult | null = null

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
    this.nativeStabilityInFlight = false
    this.postApplyWatchActive = false
    this.nativeDirty = false
    this.repairRequired = false
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
   * Reinitialize for a new document. Does NOT clear currentDocumentKey — the
   * caller manages the key via setDocumentKey()/syncDocumentContext(). The
   * observer is kept bound when the SAME DOM root is reused across documents;
   * only a detached/replaced root triggers a rebind (v28 MODEL_J).
   */
  reinitialize(): void {
    this.recordEvent('outline:reinitialize', {
      headingCount: 0, labelCount: 0, matchedCount: 0, appliedCount: 0,
    })
    // Do NOT detachObserver() here: same-root document switches must keep the
    // observer alive so Typora's async native-outline rebuild mutations are
    // captured. ensureObserverBoundToCurrentRoot NO_OPs on the same root and
    // only rebinds when the root actually changed.
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
    // Document switch: any in-flight native-stability / post-apply transaction
    // belongs to the old document and must be dropped (DROP_STALE_DOCUMENT).
    if (this.nativeStabilityInFlight || this.postApplyWatchActive || this.pendingCoverageGap !== null) {
      console.info(
        `[InkChapter Numbering] OUTLINE-STABILITY-TRANSACTION-STALE previousDocumentKey=${before || 'none'} ` +
        `newDocumentKey=${key} decision=DROP_STALE_DOCUMENT reason=DOCUMENT_SWITCH`,
      )
      this.nativeStabilityInFlight = false
      this.postApplyWatchActive = false
      this.pendingCoverageGap = null
    }

    // ── v29 MODEL_K: document switch marks dirty; readiness + full resync will ──
    // re-derive the numbering once the native outline reflects the new document.
    // rootToken staying the same across documents is NOT a bug — content
    // ownership is re-established by the matcher, not the DOM node identity.
    this.convergenceTxnId++
    this.convergenceTargetDocumentKey = key
    this.convergenceTargetRevision = this.cache.revision
    this.nativeRefreshAttempts = 0
    this.outlineContentDocumentKey = null
    this.markOutlineDirty('document-switch')
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

    // Detect heading-structure change (level/count) vs. plain text/rename.
    const prevHeadings = this.cache.headings
    const structureChanged = prevHeadings.length !== headings.length ||
      headings.some((h, i) => prevHeadings[i] && prevHeadings[i].level !== h.level)

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

    // Cache update IS the latest snapshot (latest-wins). Mark dirty, then either
    // defer to the in-flight native stability check (native dirty) or try the
    // unified full resync now.
    this.pendingPostNativeApplyRevision = this.cache.revision
    this.markOutlineDirty(structureChanged ? 'heading-structure-change' : 'heading-snapshot-change')
    if (this.nativeDirty) {
      console.info(
        `[InkChapter Numbering] OUTLINE-SNAPSHOT-DEFER documentKey=${documentKey} ` +
        `revision=${this.cache.revision} nativeDirty=true decision=DEFER_FOR_NATIVE_STABILITY`,
      )
      return
    }
    if (!findOutlineRoot()) {
      this.scheduleApply('heading-snapshot-updated')
      return
    }
    this.tryFullResyncCurrentDocument('heading-snapshot-updated')
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
   * Event-driven native stability check. Waits until nativeMutationEpoch and
   * nativeSubtreeGeneration are unchanged across two consecutive RAF checkpoints
   * (MutationObserver delivery + RAF), then applies the latest snapshot only.
   * Never uses a fixed setTimeout as a correctness gate.
   */
  private scheduleNativeStabilityCheck(reason: string): void {
    if (this.nativeStabilityInFlight) return
    this.nativeStabilityInFlight = true
    this.nativeStabilityCheckGeneration++
    const txnId = this.nativeStabilityCheckGeneration
    const docKey = this.currentDocumentKey
    const rootToken = this.rootToken
    const revision = this.cache.revision
    const epochBefore = this.nativeMutationEpoch
    const generationBefore = this.nativeSubtreeGeneration

    this.logNativeStability(txnId, docKey, rootToken, revision, epochBefore, epochBefore, generationBefore, generationBefore, false, 'WAIT', 'AWAITING_QUIESCENCE')

    requestAnimationFrame(() => {
      if (this.isStaleStabilityTxn(docKey, rootToken)) {
        this.nativeStabilityInFlight = false
        this.logNativeStability(txnId, docKey, rootToken, revision, epochBefore, this.nativeMutationEpoch, generationBefore, this.nativeSubtreeGeneration, false, 'DROP_STALE', 'DOCUMENT_OR_ROOT_CHANGED')
        return
      }
      const epochA = this.nativeMutationEpoch
      const generationA = this.nativeSubtreeGeneration
      requestAnimationFrame(() => {
        if (this.isStaleStabilityTxn(docKey, rootToken)) {
          this.nativeStabilityInFlight = false
          this.logNativeStability(txnId, docKey, rootToken, revision, epochA, this.nativeMutationEpoch, generationA, this.nativeSubtreeGeneration, false, 'DROP_STALE', 'DOCUMENT_OR_ROOT_CHANGED')
          return
        }
        const epochB = this.nativeMutationEpoch
        const generationB = this.nativeSubtreeGeneration
        const stable = epochA === epochB && generationA === generationB
        if (stable) {
          this.nativeStabilityInFlight = false
          this.nativeDirty = false
          this.repairRequired = false
          this.logNativeStability(txnId, docKey, rootToken, this.cache.revision, epochA, epochB, generationA, generationB, true, 'STABLE', 'NATIVE_QUIESCENT')

          // v29: temporal quiescence → unified full-resync entry. Readiness is
          // decided by the mature matcher (not the semantic fingerprint).
          this.tryFullResyncCurrentDocument(reason)
        } else {
          this.nativeStabilityInFlight = false
          this.logNativeStability(txnId, docKey, rootToken, this.cache.revision, epochA, epochB, generationA, generationB, false, 'WAIT', 'EPOCH_CHANGED_DURING_WINDOW')
          // New mutation arrived during the window → wait for the newest epoch/generation.
          this.scheduleNativeStabilityCheck(reason)
        }
      })
    })
  }

  private isStaleStabilityTxn(docKey: string, rootToken: number | null): boolean {
    if (this.currentDocumentKey !== docKey) return true
    if (rootToken !== null && this.rootToken !== rootToken) return true
    return false
  }

  private logNativeStability(
    txnId: number,
    documentKey: string,
    rootToken: number | null,
    revision: number,
    epochBefore: number,
    epochAfter: number,
    generationBefore: number,
    generationAfter: number,
    stable: boolean,
    decision: 'WAIT' | 'STABLE' | 'DROP_STALE',
    reason: string,
  ): void {
    console.info(
      `[InkChapter Numbering] OUTLINE-NATIVE-STABILITY documentKey=${documentKey} rootToken=${rootToken} ` +
      `revision=${revision} checkGeneration=${txnId} epochBefore=${epochBefore} epochAfter=${epochAfter} ` +
      `generationBefore=${generationBefore} generationAfter=${generationAfter} stable=${stable} ` +
      `decision=${decision} reason=${reason}`,
    )
  }

  /**
   * Evaluate semantic convergence (v28 MODEL_J): does the native outline
   * actually reflect the current document? Compares occurrence-aware
   * level+text sequences, not just counts.
   */
  private evaluateSemanticConvergence(temporalStable: boolean): SemanticConvergenceResult {
    const documentKey = this.currentDocumentKey
    const revision = this.cache.revision
    const root = findOutlineRoot() ?? findOutlineRootRelaxed()
    const headings = this.cache.headings
    const labels = this.cache.labels

    const headingSequence = buildSemanticSequence(headings.map(h => ({ level: h.level, text: normalizeOutlineText(h.text) })))
    const headingSemanticFingerprint = hashFingerprint(headingSequence.join('\n'))

    const nativeItems = root ? findOutlineNativeItems(root) : []
    const nativeSequence = buildSemanticSequence(nativeItems.map(n => ({ level: n.level, text: normalizeOutlineText(n.text) })))
    const nativeSemanticFingerprint = hashFingerprint(nativeSequence.join('\n'))

    const headingCount = headings.length
    const nativeItemCount = nativeItems.length

    const matches = root ? matchHeadingsToOutline(headings, labels, nativeItems.map(n => n.element)) : []
    const matchedCount = matches.length
    const unmatchedHeadingCount = Math.max(0, headingCount - matchedCount)
    const unmatchedOutlineCount = Math.max(0, nativeItemCount - matchedCount)

    // v29: the mature reconcile matcher is the sole business readiness authority.
    const matcherReady = matchedCount === headingCount && unmatchedHeadingCount === 0 && unmatchedOutlineCount === 0
    const fingerprintMismatch = headingSequence.join('\n') !== nativeSequence.join('\n')
    const documentKeyMatch = documentKey !== '' && this.cache.documentKey === documentKey
    const semanticReady = temporalStable && documentKeyMatch && matcherReady

    return {
      documentKey,
      revision,
      rootToken: this.rootToken,
      convergenceTxnId: this.convergenceTxnId,
      headingCount,
      nativeItemCount,
      matchedCount,
      unmatchedHeadingCount,
      unmatchedOutlineCount,
      headingSemanticFingerprint,
      nativeSemanticFingerprint,
      temporalStable,
      semanticReady,
      fingerprintMismatch,
      decision: semanticReady ? 'PASS' : 'WAIT_OR_REFRESH',
      reason: !documentKeyMatch ? 'DOCUMENT_KEY_MISMATCH'
        : !matcherReady ? 'NATIVE_OUTLINE_NOT_CAUGHT_UP'
          : 'OK',
    }
  }

  private logReadiness(sem: SemanticConvergenceResult): void {
    const ready = sem.semanticReady
    if (ready) this.readinessReadyCount++
    else this.readinessWaitCount++
    console.info(
      `[InkChapter Numbering] OUTLINE-CURRENT-DOCUMENT-READINESS documentKey=${sem.documentKey} revision=${sem.revision} ` +
      `rootToken=${sem.rootToken} headingCount=${sem.headingCount} nativeItemCount=${sem.nativeItemCount} ` +
      `matchedCount=${sem.matchedCount} unmatchedHeadingCount=${sem.unmatchedHeadingCount} ` +
      `unmatchedOutlineCount=${sem.unmatchedOutlineCount} outlineVisible=${findOutlineRoot() !== null} ` +
      `ready=${ready} decision=${ready ? 'READY' : 'WAIT_NATIVE'} reason=${sem.reason}`,
    )
    // v29: fingerprint mismatch is diagnostic-only and never blocks full resync.
    if (ready && sem.fingerprintMismatch) {
      this.semanticDiagnosticMismatchCount++
      console.info(
        `[InkChapter Numbering] OUTLINE-SEMANTIC-FINGERPRINT-DIAGNOSTIC documentKey=${sem.documentKey} ` +
        `headingSemanticFingerprint=${sem.headingSemanticFingerprint} nativeSemanticFingerprint=${sem.nativeSemanticFingerprint} ` +
        `decision=NON_BLOCKING_MISMATCH reason=SEMANTIC_FINGERPRINT_DIFFERS`,
      )
    }
  }

  /** Mark the outline numbering as dirty, requiring a full resync. */
  private markOutlineDirty(reason: OutlineDirtyReason): void {
    this.outlineDirty = true
    this.outlineDirtyReason = reason
    this.dirtyMarkCount++
    console.info(
      `[InkChapter Numbering] OUTLINE-DIRTY documentKey=${this.currentDocumentKey} ` +
      `revision=${this.cache.revision} reason=${reason} decision=MARKED`,
    )
  }

  /**
   * Unified full-resync entry (v29 MODEL_K). Reads the current document + latest
   * snapshot + current native outline, then uses the mature matcher as the sole
   * readiness authority. Only writes decorations after READY; the semantic
   * fingerprint is diagnostic-only and never blocks.
   */
  private tryFullResyncCurrentDocument(trigger: string): void {
    if (!this.outlineDirty) return
    const root = findOutlineRoot()
    if (!root) {
      // Root missing: keep dirty and register the root-availability watch.
      this.scheduleApply(trigger)
      return
    }
    const sem = this.evaluateSemanticConvergence(true)
    this.lastSemanticResult = sem
    this.lastReadiness = sem
    this.logReadiness(sem)
    if (!sem.semanticReady) {
      // WAIT_NATIVE: keep dirty, do not modify DOM, wait for the next real event.
      return
    }
    this.applyLatestSnapshot([trigger])
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
    // never reported a native mutation, the observer may have a coverage gap.
    // This is a TWO-PHASE check: a changed fingerprint with an unchanged epoch is
    // only PENDING_DELIVERY (the MutationObserver callback may not have fired yet);
    // a final FAIL requires the epoch to still be unchanged after a delivery
    // checkpoint (microtask + RAF).
    const prevText = this.nativeTextFingerprint
    const prevStruct = this.nativeStructureFingerprint
    const hasPrev = prevText !== '' || prevStruct !== ''
    const changed = hasPrev && (sampled.textFingerprint !== prevText || sampled.structureFingerprint !== prevStruct)
    if (changed && this.nativeMutationEpoch === this.lastSampleEpoch) {
      this.handleCoverageGapPending(sampled.textFingerprint, sampled.structureFingerprint)
    }
    this.lastSampleEpoch = this.nativeMutationEpoch

    this.nativeItemCount = sampled.itemCount
    this.nativeTextFingerprint = sampled.textFingerprint
    this.nativeStructureFingerprint = sampled.structureFingerprint
    return sampled
  }

  /** Two-phase coverage-gap: PENDING_DELIVERY now, FAIL only after delivery checkpoint. */
  private handleCoverageGapPending(textFingerprint: string, structureFingerprint: string): void {
    this.coverageGapPendingCount++
    const documentKey = this.currentDocumentKey
    const rootToken = this.rootToken
    const epochAtSample = this.nativeMutationEpoch
    console.info(
      `[InkChapter Numbering] OUTLINE-OBSERVER-COVERAGE-GAP phase=PENDING_DELIVERY decision=WAIT ` +
      `documentKey=${documentKey} rootToken=${rootToken} currentFingerprint=${textFingerprint}/${structureFingerprint} ` +
      `epochAtSample=${epochAtSample} reason=FINGERPRINT_CHANGED_BEFORE_MUTATION_DELIVERY`,
    )
    this.pendingCoverageGap = { documentKey, rootToken, epochAtSample, textFingerprint, structureFingerprint }
    // Delivery checkpoint: MutationObserver callback is a microtask; the next RAF
    // is a safe boundary to decide whether the epoch finally advanced.
    queueMicrotask(() => {
      requestAnimationFrame(() => {
        const pending = this.pendingCoverageGap
        if (!pending) return
        this.pendingCoverageGap = null
        if (pending.documentKey !== this.currentDocumentKey || (pending.rootToken !== null && pending.rootToken !== this.rootToken)) {
          console.info(
            `[InkChapter Numbering] OUTLINE-OBSERVER-COVERAGE-GAP phase=POST_DELIVERY decision=DROP_STALE ` +
            `documentKey=${pending.documentKey} reason=DOCUMENT_OR_ROOT_CHANGED`,
          )
          return
        }
        if (this.nativeMutationEpoch !== pending.epochAtSample) {
          this.coverageGapResolvedCount++
          console.info(
            `[InkChapter Numbering] OUTLINE-OBSERVER-COVERAGE-GAP phase=POST_DELIVERY decision=RESOLVED ` +
            `documentKey=${pending.documentKey} epochBefore=${pending.epochAtSample} epochAfter=${this.nativeMutationEpoch} ` +
            `reason=MUTATION_DELIVERED_AFTER_SAMPLE`,
          )
        } else {
          this.coverageGapFailCount++
          console.info(
            `[InkChapter Numbering] OUTLINE-OBSERVER-COVERAGE-GAP phase=POST_DELIVERY decision=FAIL ` +
            `documentKey=${pending.documentKey} epochAtSample=${pending.epochAtSample} currentEpoch=${this.nativeMutationEpoch} ` +
            `reason=FINGERPRINT_CHANGED_WITHOUT_MUTATION_EVENT`,
          )
        }
      })
    })
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
      `instanceId=${this.instanceId} codepathRevision=v29 found=true connected=${root.isConnected} visible=true ` +
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

    // v29 FULL RESYNC begin: deterministic rebuild of the derived numbering view.
    this.fullResyncGeneration++
    this.fullResyncBeginCount++
    console.info(
      `[InkChapter Numbering] OUTLINE-FULL-RESYNC-BEGIN documentKey=${expectedDocKey} revision=${expectedRevision} ` +
      `rootToken=${this.rootToken} generation=${this.fullResyncGeneration} dirtyReason=${this.outlineDirtyReason ?? 'none'} ` +
      `headingCount=${this.cache.headings.length} nativeItemCount=${nativeAtApply.itemCount}`,
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

      // Post-apply diagnostics: label mismatch + orphan decorations.
      let labelMismatchCount = 0
      for (const m of matches) {
        if (m.label && m.element.getAttribute('data-inkchapter-number') !== m.label) labelMismatchCount++
      }
      let orphanDecorationCount = 0
      const decoratedAfterApply = root.querySelectorAll<HTMLElement>('[data-inkchapter-number]')
      decoratedAfterApply.forEach(el => { if (!matchedSet.has(el)) orphanDecorationCount++ })

      this.lastApply = {
        matchedCount: matches.length,
        appliedCount: attrResult.applied + attrResult.updated,
        unmatchedCount: unmatchedHeading,
        unmatchedOutlineCount: unmatchedOutline,
        staleDecorationCount,
        duplicateDecorationCount: 0, // matchHeadingsToOutline dedups via usedOutlineIndices
        orphanDecorationCount,
        labelMismatchCount,
        headingCount: this.cache.headings.length,
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
        `staleDecorationCount=${staleDecorationCount} orphanDecorationCount=${orphanDecorationCount} ` +
        `labelMismatchCount=${labelMismatchCount}`,
      )

      // v29 FULL RESYNC end: immediate verify decision + dirty→clean transition.
      const resyncPass = expectedNumbered === actualDecorations &&
        staleDecorationCount === 0 && orphanDecorationCount === 0 && labelMismatchCount === 0
      if (resyncPass) {
        this.fullResyncPassCount++
        this.outlineDirty = false
        this.outlineDirtyReason = null
      } else {
        this.fullResyncFailCount++
      }
      console.info(
        `[InkChapter Numbering] OUTLINE-FULL-RESYNC-END documentKey=${expectedDocKey} revision=${expectedRevision} ` +
        `rootToken=${this.rootToken} generation=${this.fullResyncGeneration} ` +
        `removedDecorationCount=${staleRemoved} createdDecorationCount=${attrResult.applied + attrResult.updated} ` +
        `updatedDecorationCount=${attrResult.updated} expectedDecorationCount=${expectedNumbered} ` +
        `actualDecorationCount=${actualDecorations} decision=${resyncPass ? 'PASS' : 'FAIL'} ` +
        `reason=${resyncPass ? 'OK' : 'DECORATION_COUNT_MISMATCH'}`,
      )

      // Decoration-loss repair: expected numbered > 0 but decorations dropped to 0.
      if (expectedNumbered > 0 && actualDecorations === 0) {
        console.info(`[InkChapter Numbering] OUTLINE-DECORATION-LOSS-DETECT expected=${expectedNumbered} actual=${actualDecorations} decision=REPAIR`)
        const attempts = this.verifyRepairByRevision.get(expectedRevision) ?? 0
        if (attempts < 1) {
          this.verifyRepairByRevision.set(expectedRevision, attempts + 1)
          this.repairRequired = true
          this.nativeDirty = true
          this.scheduleNativeStabilityCheck('outline-decoration-lost')
        }
      }
    } finally {
      this.isWriting = false
    }

    this.scheduleImmediateVerify(expectedDocKey, expectedRevision)
    this.startPostApplyStabilityWatch(expectedDocKey, expectedRevision)
  }

  private scheduleImmediateVerify(docKey: string, revision: number): void {
    if (this.verifyRafId !== null) return
    this.verifyRafId = requestAnimationFrame(() => {
      this.verifyRafId = null
      this.verifyOutline(docKey, revision, 'IMMEDIATE')
    })
  }

  /**
   * Post-apply stability watch: after writing decorations, cross a
   * MutationObserver delivery boundary + RAF checkpoint and confirm the native
   * epoch/generation did not change. If it did, invalidate → repair → stability.
   */
  private startPostApplyStabilityWatch(docKey: string, revision: number): void {
    this.postApplyWatchActive = true
    this.postApplyWatchEpoch = this.nativeMutationEpoch
    this.postApplyWatchGeneration = this.nativeSubtreeGeneration
    this.postApplyWatchRevision = revision
    const appliedEpoch = this.nativeMutationEpoch
    const appliedGeneration = this.nativeSubtreeGeneration
    const appliedRootToken = this.rootToken

    queueMicrotask(() => {
      requestAnimationFrame(() => {
        if (!this.postApplyWatchActive) return
        if (this.currentDocumentKey !== docKey || (appliedRootToken !== null && this.rootToken !== appliedRootToken)) {
          this.postApplyWatchActive = false
          console.info(
            `[InkChapter Numbering] OUTLINE-POST-APPLY-STABILITY documentKey=${docKey} revision=${revision} ` +
            `rootToken=${appliedRootToken} appliedEpoch=${appliedEpoch} currentEpoch=${this.nativeMutationEpoch} ` +
            `appliedGeneration=${appliedGeneration} currentGeneration=${this.nativeSubtreeGeneration} ` +
            `decision=DROP_STALE reason=DOCUMENT_OR_ROOT_CHANGED`,
          )
          return
        }
        const currentEpoch = this.nativeMutationEpoch
        const currentGeneration = this.nativeSubtreeGeneration
        const stable = currentEpoch === appliedEpoch && currentGeneration === appliedGeneration
        if (stable) {
          this.postApplyWatchActive = false
          console.info(
            `[InkChapter Numbering] OUTLINE-POST-APPLY-STABILITY documentKey=${docKey} revision=${revision} ` +
            `rootToken=${appliedRootToken} appliedEpoch=${appliedEpoch} currentEpoch=${currentEpoch} ` +
            `appliedGeneration=${appliedGeneration} currentGeneration=${currentGeneration} ` +
            `decision=STABLE reason=NATIVE_QUIESCENT_AFTER_APPLY`,
          )
          this.verifyOutline(docKey, revision, 'STABLE')
        } else {
          this.postApplyWatchActive = false
          this.postApplyInvalidationCount++
          console.info(
            `[InkChapter Numbering] OUTLINE-POST-APPLY-STABILITY documentKey=${docKey} revision=${revision} ` +
            `rootToken=${appliedRootToken} appliedEpoch=${appliedEpoch} currentEpoch=${currentEpoch} ` +
            `appliedGeneration=${appliedGeneration} currentGeneration=${currentGeneration} ` +
            `decision=INVALIDATED reason=NATIVE_MUTATION_AFTER_APPLY`,
          )
          this.repairScheduleCount++
          console.info(
            `[InkChapter Numbering] OUTLINE-REPAIR-SCHEDULE documentKey=${docKey} revision=${revision} ` +
            `rootToken=${appliedRootToken} reason=native-outline-rebuilt-after-apply`,
          )
          this.repairRequired = true
          this.nativeDirty = true
          this.scheduleNativeStabilityCheck('post-apply-invalidated')
        }
      })
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

  private verifyOutline(docKey: string, revision: number, phase: 'IMMEDIATE' | 'STABLE'): void {
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

    // Native stability: has the native subtree changed since apply?
    const nativeEpochStable = this.nativeMutationEpoch === this.postApplyEpochAtApply
    const nativeGenerationStable = this.nativeSubtreeGeneration === this.postApplyGenerationAtApply

    const la = this.lastApply
    const matchedCount = la?.matchedCount ?? 0
    const headingCount = la?.headingCount ?? this.cache.headings.length
    const unmatchedHeadingCount = la?.unmatchedCount ?? 0
    const unmatchedOutlineCount = la?.unmatchedOutlineCount ?? 0
    const duplicateDecorationCount = la?.duplicateDecorationCount ?? 0
    const orphanDecorationCount = la?.orphanDecorationCount ?? 0
    const labelMismatchCount = la?.labelMismatchCount ?? 0

    const countOk =
      expectedNumbered === actualDecorations &&
      staleDecorationCount === 0 &&
      duplicateDecorationCount === 0 &&
      orphanDecorationCount === 0 &&
      labelMismatchCount === 0
    const matchOk = matchedCount === headingCount && unmatchedHeadingCount === 0 && unmatchedOutlineCount === 0
    const identityOk = rootSame && rootGenerationSame && rootTokenSame

    let decision: 'PASS' | 'FAIL' | 'DEFER' | 'RETRY'
    let reason: string

    if (!tx) {
      decision = 'FAIL'; reason = 'NO_APPLY_TRANSACTION'
    } else if (expectedNumbered === 0) {
      decision = 'PASS'; reason = 'NO_NUMBERED_HEADINGS'
    } else if (!identityOk) {
      decision = 'RETRY'; reason = 'ROOT_REPLACED_AFTER_APPLY'
    } else if (!rootConnected || !rootVisible) {
      decision = 'FAIL'; reason = 'ROOT_NOT_VISIBLE'
    } else if (phase === 'IMMEDIATE') {
      // Immediate verify is a transient sanity check only — never final success.
      if (countOk && matchOk) {
        decision = 'PASS'; reason = 'IMMEDIATE_OK'
      } else {
        this.immediateVerifyFailCount++
        decision = 'DEFER'; reason = this.nativeDirty ? 'TRANSIENT_NATIVE_LAG' : 'IMMEDIATE_MISMATCH_AWAITING_STABLE'
      }
    } else {
      // STABLE verify — final gate: document identity + matcher READY + post-apply
      // temporal stability. The mature matcher (matched/unmatched) is the sole
      // readiness authority; the semantic fingerprint is NOT a stable-verify gate.
      if (!nativeEpochStable || !nativeGenerationStable) {
        this.stableVerifyFailCount++
        decision = 'RETRY'; reason = 'NATIVE_OUTLINE_MUTATED_AFTER_APPLY'
      } else if (!countOk || !matchOk) {
        this.stableVerifyFailCount++
        if (actualDecorations < expectedNumbered) this.finalDecorationLossCount++
        decision = 'FAIL'; reason = 'TERMINAL_MISMATCH'
      } else {
        decision = 'PASS'; reason = 'OK'
      }
    }

    this.lastVerify = { expectedCount: expectedNumbered, actualCount: actualDecorations, decision, phase }

    // Literal phase marker (kept as a contiguous string in the bundle for the
    // dist-marker gate: phase=IMMEDIATE / phase=STABLE).
    const phaseLabel = phase === 'IMMEDIATE' ? 'phase=IMMEDIATE' : 'phase=STABLE'

    console.info(
      `[InkChapter Numbering] OUTLINE-VERIFY documentKey=${docKey} revision=${revision} ${phaseLabel} ` +
      `expectedNumberedCount=${expectedNumbered} actualNumberDecorationCount=${actualDecorations} ` +
      `rootConnected=${rootConnected} rootVisible=${rootVisible} rootSame=${rootSame} ` +
      `rootGenerationSame=${rootGenerationSame} rootTokenSame=${rootTokenSame} decision=${decision} reason=${reason}`,
    )
    console.info(
      `[InkChapter Numbering] OUTLINE-STRICT-VERIFY documentKey=${docKey} revision=${revision} ${phaseLabel} ` +
      `expected=${expectedNumbered} actual=${actualDecorations} ` +
      `matchedCount=${matchedCount} headingCount=${headingCount} ` +
      `unmatchedHeadingCount=${unmatchedHeadingCount} unmatchedOutlineCount=${unmatchedOutlineCount} ` +
      `staleDecorationCount=${staleDecorationCount} duplicateDecorationCount=${duplicateDecorationCount} ` +
      `orphanDecorationCount=${orphanDecorationCount} labelMismatchCount=${labelMismatchCount} ` +
      `rootSame=${rootSame} rootTokenSame=${rootTokenSame} ` +
      `nativeEpochStable=${nativeEpochStable} nativeGenerationStable=${nativeGenerationStable} ` +
      `decision=${decision} reason=${reason}`,
    )

    // Match-state: distinguish transient native lag from terminal mismatch.
    if (!countOk || !matchOk) {
      console.info(
        `[InkChapter Numbering] OUTLINE-MATCH-STATE documentKey=${docKey} revision=${revision} phase=${phase} ` +
        `headingCount=${headingCount} matchedCount=${matchedCount} nativeDirty=${this.nativeDirty} ` +
        `state=${phase === 'IMMEDIATE' ? 'IMMEDIATE_MISMATCH' : 'TERMINAL_MISMATCH'} ` +
        `decision=${decision === 'FAIL' ? 'FAIL' : 'DEFER'}`,
      )
    }

    if (phase === 'STABLE' && decision === 'FAIL') {
      console.info(
        `[InkChapter Numbering] OUTLINE-STABLE-VERIFY-FAIL documentKey=${docKey} revision=${revision} ` +
        `reason=${reason} expected=${expectedNumbered} actual=${actualDecorations}`,
      )
    }

    if (decision === 'RETRY') {
      if (reason === 'NATIVE_OUTLINE_MUTATED_AFTER_APPLY') {
        // MODEL F repair: native rebuilt after apply — wait quiescence and re-apply.
        this.repairScheduleCount++
        console.info(
          `[InkChapter Numbering] OUTLINE-REPAIR-SCHEDULE documentKey=${docKey} revision=${revision} ` +
          `reason=native-outline-rebuilt-after-apply`,
        )
        this.repairRequired = true
        this.nativeDirty = true
        this.markOutlineDirty('verify-repair')
        this.scheduleNativeStabilityCheck('outline-native-rebuilt-after-apply')
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
    if (oldRootToken !== null && oldRootToken !== newRootToken) {
      // Root replacement: drop any in-flight stability / post-apply transactions.
      console.info(
        `[InkChapter Numbering] OUTLINE-STABILITY-TRANSACTION-STALE oldRootToken=${oldRootToken} ` +
        `newRootToken=${newRootToken} decision=DROP_STALE_ROOT reason=ROOT_REPLACED`,
      )
      this.nativeStabilityInFlight = false
      this.postApplyWatchActive = false
      this.pendingCoverageGap = null
    }
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
        this.nativeDirty = true
        this.repairRequired = true
        this.markOutlineDirty('native-subtree-rebuild')
        this.lastNativeMutationAt = performance.now()
        this.lastNativeMutationAtRevision = this.cache.revision
        this.lastNativeMutationRootToken = this.rootToken
        this.nativeMutationCount += nativeMutationCount
        this.nativeBurstCount++
        console.info(
          `[InkChapter Numbering] OUTLINE-NATIVE-SUBTREE-MUTATION documentKey=${this.currentDocumentKey} rootToken=${this.rootToken} ` +
          `source=TYPOGRAPHIC_NATIVE mutationCount=${nativeMutationCount} addedNativeItemCount=${addedNativeItemCount} ` +
          `removedNativeItemCount=${removedNativeItemCount} nativeMutationEpoch=${this.nativeMutationEpoch} ` +
          `nativeSubtreeGeneration=${this.nativeSubtreeGeneration} nativeDirty=true repairRequired=true ` +
          `decision=TRACKED`,
        )
        this.scheduleNativeStabilityCheck('outline-native-mutation')
      } else if (classOnlyChange) {
        // Pure active/visual class change (outline-active / outline-item-active):
        // state event only — never a structural repair, never a native epoch bump.
        console.info('[InkChapter Numbering] OUTLINE-MUTATION-CLASSIFY source=VISUAL_ATTRIBUTE reason=ACTIVE_CLASS_CHANGE repairRequired=false')
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
      // Decoration loss is a STRONG repair signal — mark dirty and go through
      // native stability → full resync (never apply before READY).
      this.repairRequired = true
      this.nativeDirty = true
      this.markOutlineDirty('decoration-loss')
      this.scheduleNativeStabilityCheck('decoration-loss')
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
      nativeDirty: this.nativeDirty,
      repairRequired: this.repairRequired,
      nativeStabilityInFlight: this.nativeStabilityInFlight,
      postApplyWatchActive: this.postApplyWatchActive,
      nativeStabilityCheckGeneration: this.nativeStabilityCheckGeneration,
      pendingPostNativeApplyRevision: this.pendingPostNativeApplyRevision,
      lastNativeMutationAtRevision: this.lastNativeMutationAtRevision,
      lastNativeMutationRootToken: this.lastNativeMutationRootToken,
      outlineContentDocumentKey: this.outlineContentDocumentKey,
      outlineContentGeneration: this.outlineContentGeneration,
      documentSwitchConvergencePending: this.documentSwitchConvergencePending,
      convergenceTargetDocumentKey: this.convergenceTargetDocumentKey,
      convergenceTargetRevision: this.convergenceTargetRevision,
      convergenceTxnId: this.convergenceTxnId,
      nativeRefreshAttempts: this.nativeRefreshAttempts,
      nativeRefreshGeneration: this.nativeRefreshGeneration,
      lastSemanticResult: this.lastSemanticResult,
      outlineDirty: this.outlineDirty,
      outlineDirtyReason: this.outlineDirtyReason,
      fullResyncGeneration: this.fullResyncGeneration,
      lastReadiness: this.lastReadiness,
      stats: {
        nativeMutationCount: this.nativeMutationCount,
        nativeBurstCount: this.nativeBurstCount,
        postNativeApplyCount: this.postNativeApplyCount,
        repairScheduleCount: this.repairScheduleCount,
        postApplyInvalidationCount: this.postApplyInvalidationCount,
        coverageGapPendingCount: this.coverageGapPendingCount,
        coverageGapResolvedCount: this.coverageGapResolvedCount,
        coverageGapFailCount: this.coverageGapFailCount,
        immediateVerifyFailCount: this.immediateVerifyFailCount,
        stableVerifyFailCount: this.stableVerifyFailCount,
        finalDecorationLossCount: this.finalDecorationLossCount,
        dirtyMarkCount: this.dirtyMarkCount,
        readinessReadyCount: this.readinessReadyCount,
        readinessWaitCount: this.readinessWaitCount,
        fullResyncBeginCount: this.fullResyncBeginCount,
        fullResyncPassCount: this.fullResyncPassCount,
        fullResyncFailCount: this.fullResyncFailCount,
        staleDocumentDropCount: this.staleDocumentDropCount,
        staleRootDropCount: this.staleRootDropCount,
        semanticDiagnosticMismatchCount: this.semanticDiagnosticMismatchCount,
      },
    }
  }
}
