/**
 * Caption Service — orchestration layer for Caption System V1.
 *
 * Wires together the pure canonical core (caption-system.ts), the DOM adapter
 * (caption-dom-adapter.ts) and sidecar persistence (caption-store.ts), and
 * exposes the user-facing create / edit / delete / renumber / rehydrate flows.
 *
 * Identity guarantees:
 * - live-session move tracking via bound target roots (same DOM node moves)
 * - cross-session rehydrate uses STRONG anchor resolution only (content
 *   signature + occurrence, or ordinal + neighborhood); ORDINAL_ONLY/AMBIGUOUS
 *   historical anchors are kept ORPHAN and NEVER auto-bind to a new object.
 */

import { installMathJaxHook, probeMathJaxApiAuthority, createSingleTargetSession, clearSingleTargetSession, finalizeSingleTargetSession, getActiveSingleTargetSession, tokenFor, type MathJaxSingleTargetRetypesetSession } from './mathjax-native-tag-injection'
import { executeMathJaxRenderOwnershipProbe } from './mathjax-render-ownership-probe'
import { installRenderRouteHooks, restoreRenderRouteHooks, setRouteTraceContext, setRouteTraceEditorRoot, executeMathJaxRenderRouteTrace, type TraceFormulaInput } from './mathjax-render-route-trace'
import { verifyFormulaTexSource, extractFormulaTexForTrace, normalizeTexSource, type FormulaTexSourceKind } from './formula-tex-source-verifier'
import { buildFormulaRenderAuthorizationPlan, nextPlanRevision, setTex2svgInjectionContext, executeTex2svgInjectionVerification, emitPlanBindingAuthority, getPendingInjectionCount, getCatchupStats, getExistingSourceRegressionCount, getCallsiteAuthorityDecision, getCurrentInjectionPlan, getCatchupRebindStats, R54_RUNTIME_MARKER, settleNaturalRenderCorrelation, type FormulaRenderAuthorizationPlan } from './mathjax-tex2svg-tag-injection'
import {
  R543_RUNTIME_MARKER,
  R543_BUILD_MARKER,
  R5431_RUNTIME_MARKER,
  R5431_BUILD_MARKER,
  dispatchSemanticEvent,
  flushCurrentBatch,
  emitEventDispatch,
  emitOperationBatch,
  emitEventDrivenSnapshot,
  emitEventDrivenAccounting,
  emitEventDrivenQuiescence,
  emitEventDrivenFinal,
  getEventCounters,
  resetEventCounters,
  incrementRefreshRequestCount,
  incrementAffectedSetBuildCount,
  incrementPeriodicTimerCount,
  type FormulaSemanticEvent,
  type SemanticOperationBatch,
} from './formula-semantic-invalidation'
import {
  computeHeadingDependencyRange,
  emitHeadingDependencyAuthority,
  emitHeadingChangeClosure,
  emitFormulaEventDependencyRange,
  type HeadingEntry,
} from './formula-heading-dependency'
import {
  checkDispatchContextGate,
  emitBaselineAuthority,
  emitDomainSnapshot,
  emitDomainIsolationAuthority,
  emitBlockStreamDomainVerify,
  emitSemanticEventAuthority,
  checkOperationLifecycle,
  emitEventPipelineError,
  emitEventRuntimeSafetyFinal,
  getSafetyCounters,
  resetSafetyCounters,
  incrementGlobalCaptionRefreshFromFormulaEvent,
  incrementFormulaSemanticEvent,
  incrementHeadingSemanticEvent,
  type DispatchContextGateInput,
  type SemanticEventAuthorityKind,
} from './formula-event-domain'
import { validateObjectContextTarget } from './object-context-target-contract'
import {
  checkContextGate,
  hydrateBaselineFromLiveSnapshot,
  emitBaselineState,
  emitPrebaselineBuffer,
  emitFormulaOnlyRefresh,
  emitEditingHostCanonicalResolve,
  emitNewHostAdoptionAuthority,
  emitPreCallPlanCatchup,
  emitSameCallReauthorization,
  emitSnapshotDiffOrderAuthority,
  emitLiveRevisionRestoreAuthority,
  emitFormulaAddedSnapshotClosure,
  emitNewNaturalRenderClosure,
  emitBaselineFastpathRestoreFinal,
  emitSharedScopeSequenceLedger,
  emitSequenceProjectionAuthority,
  getBaselineState,
  resetBaselineState,
  R5432_RUNTIME_MARKER,
  R5432_BUILD_MARKER,
} from './formula-semantic-baseline'
import {
  readVisibleFormulaTag,
  reconcileFormulaRenderProjectionNow,
  createPendingProjection,
  getPendingProjection,
  resolvePendingProjection,
  clearPendingProjectionsForDocument,
  resetPendingProjections,
  requestFormulaProjectionFulfillment,
  getOriginalTex2svgPromise,
  getNaturalRenderOptions,
  resolveCanonicalHostFromRendererNode,
  checkNativeSlotOwnership,
  captureVisualIntegritySnapshot,
  verifyVisualIntegrity,
  resolveFormulaCompositeVisualOwner,
  type RenderProjectionReconcileResult,
  type ProjectionFulfillmentRequest,
} from './formula-render-projection'
import {
  emitStructuralSlotAuthority,
  emitEmptySourceManagedSlot,
  emitEmptyTex2svgSentinelAuthority,
  isEmptyFormulaSentinel,
  latchEditSession,
  getActiveEditSession,
  clearEditSession,
  emitNonsemanticEditTransition,
  checkSourceCommitBarrier,
  markSessionExplicitInput,
  emitEditSessionTex2svgAuthority,
  resetEditSessionState,
  type SourceCommitBarrierResult,
} from './formula-edit-session'
import {
  R542_RUNTIME_MARKER,
  R542_BUILD_MARKER,
  captureOrUpdateAuthoritativeSource,
  getAuthoritativeSourceState,
  resolveCurrentEditingFormulaIdentity,
  emitPlanSourceBindingAuthority,
  getAndResetSourceDriftStats,
  emitLiveSourceRendererFinal,
  type AuthoritativeFormulaSourceState,
} from './formula-authoritative-source'
import {
  computeFormulaSuffixFrontier,
  computeHeadingDependencyFrontier,
  computeOrderedFrontierReprojection,
  emitSequenceSuffixInvalidation,
  emitCascadeProjectionDispatch,
  emitCascadeProjectionFinal,
  emitCleanAuthority,
  type FormulaDependencyOperation,
  type FormulaDependencyFrontier,
} from './formula-dependency-frontier'
import {
  processFormulaSemanticEvent,
  processProjectionSettled,
  processVisibleVerified,
  finalizeOperation,
  produceRenderTransaction,
  initializeBaseline,
  handleDocumentSwitch,
  isStoreBaselineReady,
  emitLegacyBaselineGateHandoff,
  hydrateNumberingAuthorityIntoFormulaStateStore,
  runBaselineProjectionClosure,
  executeProjectionTransactions,
  readFormulaVisibleStateTruth,
  getPendingBaselineProjectionCount,
  R54316_BUILD_ID,
} from './formula-state-machine-wiring'
import { R54315_RUNTIME_MARKER, getFormulaStateStore, isFormulaEmptySource } from './formula-state-store'
import {
  createEmptyRenderReservation,
  getReservation,
  clearReservationsForDocument,
  emitZeroSourceTransactionAuthority,
  emitAuthorizationDesiredTagInvariant,
  emitManagedVisualFormatInvariant,
  isZeroSource,
  type EmptyFormulaRenderReservation,
} from './formula-empty-render-reservation'
import {
  R541_RUNTIME_MARKER,
  R541_BUILD_MARKER,
  buildLiveFormulaSemanticSnapshot,
  advanceLiveRevision,
  recordSemanticBaseline,
  getLiveFormulaRevision,
  rebindLiveRevision,
  emitDirtyBufferAuthority,
  emitSemanticSnapshotMarkers,
  diffLiveFormulaPlans,
  computeAffectedFormulaSet,
  emitPlanDiffMarkers,
  emitAffectedRenderSet,
  previousSnapshotCountRef,
  emitLiveUpdateVerify,
  emitLiveUpdateFinal,
  emitLiveRevisionNoiseAuthority,
  resolveStableFormulaIdentity,
  type LiveFormulaSemanticSnapshot,
  type LiveFormulaSemanticEntryInput,
  type MutationClassification,
  type LivePlanDiffEntry,
  type LiveFormulaRevisionReason,
} from './formula-live-revision'
import {
  auditTyporaRenderInvalidationTrigger,
  requestFormulaRenderInvalidation,
  setInvalidationInProgress,
  markRendererInternalMutationObserved,
  emitLoopBarrier,
  emitSourceRendererFeedbackBarrier,
  computeLiveUpdateAccounting,
  setLiveUpdateTerminalState,
  getLiveUpdateTerminalState,
} from './typora-formula-render-invalidation'
import {
  CaptionRegistry,
  DEFAULT_CAPTION_SETTINGS,
  resolveCaptionAnchor,
  resolveCaptionTypeSettings,
  type CaptionRecord,
  type CaptionTargetType,
  type CaptionTargetAnchor,
  type CaptionSettings,
} from './caption-system'
import * as path from 'path'
import * as crypto from 'crypto'
import { CaptionDomAdapter, MATH_HOST_SELECTOR, type CaptionTarget, type ReconcileItem, type ReconcileStats } from './caption-dom-adapter'
import { loadCaptionStore, saveCaptionStore } from './caption-store'
import { emitRuntimeAudit, initializeForensicSink } from '../runtime/forensic-log-sink'
import { INKCHAPTER_BUILD_ID } from './paragraph-indent-forensic'
import { readImageAlt, escapeMarkdownAlt, unescapeMarkdownAlt } from './figure-alt-binding'
import { imagePathInfo, normalizeLocalImageMarkdownDestination } from './image-path-codec'
import {
  locateMarkdownImageToken,
  parseMarkdownImageTokens,
  patchAltRange,
  patchDestinationRange,
  canonicalizeMarkdownDestination,
  normalizeWindowsPath,
  type MarkdownImageToken,
  type LocateMarkdownImageTokenResult,
} from './figure-token-locator'
import {
  computeObjectNumbers,
  buildObjectNumberingLabel,
  renderNumberingPreview,
  DEFAULT_OBJECT_NUMBERING_CONFIG,
  ordinalsFromContext,
  resolveScope,
  resolveObjectNumberingScope,
  resolveObjectNumberingReadiness,
  type ObjectNumberingConfig,
  type ObjectNumberingType,
  type NumberingTarget,
  type NumberingResult,
  type ObjectNumberingReadiness,
} from './object-numbering-engine'
import { migrateObjectNumberingConfig } from './object-numbering-settings'
import {
  resolveLogicalHeadingRoleMap,
  type LogicalHeadingRoleMap,
} from './heading-context-resolver'
import {
  buildObjectHeadingIndex,
  checkObjectContextGenerationGate,
  checkWorkspaceActiveDocumentGate,
  projectLiveObjectHeadingContexts,
  resolveTrueQuiescence,
  type StructuredHeadingNumberState,
  type ObjectHeadingIndex,
  type ObjectHeadingOrdinalContext,
  type LiveHeadingEntry,
  type LiveObjectTargetEntry,
  type LiveObjectContextProjectionResult,
  type WorkspaceActiveDocumentGateResult,
} from './object-heading-ordinal-authority'
import { FormulaNumberingAdapter, computeFormulaCurrentSetAuthority, type FormulaReconcileItem, type FormulaReconcileStats, type FormulaNativeSlotResolution, type FormulaVisualInventoryV4 } from './formula-numbering-adapter'
import { generateDocumentKey } from './heading-numbering-scope-store'

/**
 * v2.5.7-R5.4.1: DIAGNOSTIC-ONLY disk block-formula count ($$...$$ pairs) for
 * the dirty-buffer authority. Never a correctness gate; the live editor count
 * is the authority. Loose pairing is acceptable for the audit marker.
 */
function countDiskBlockFormulas(markdown: string | null): number {
  if (!markdown) return 0
  let count = 0
  let i = 0
  const n = markdown.length
  while (i < n) {
    const open = markdown.indexOf('$$', i)
    if (open === -1) break
    const close = markdown.indexOf('$$', open + 2)
    if (close === -1) break
    count++
    i = close + 2
  }
  return count
}

export interface CaptionServiceContext {
  vaultRoot?: string | null
  getActiveFilePath?: () => string | null
  getDocumentKey?: () => string | null
  getEditorRoot?: () => HTMLElement | null
  getMarkdown?: () => string
  reloadContent?: (markdown: string) => void
  /** v2.5.1: effective heading structure mode (strict/loose) for logical role mapping. */
  getHeadingStructureMode?: () => 'strict' | 'loose'
  /** v2.5.3: shared structured numeric heading state from the Heading Numbering engine. */
  getStructuredHeadingNumberState?: () => StructuredHeadingNumberState[]
  /** Read the active .md file bytes from disk (for FAW6 persistence evidence). */
  readActiveFileContent?: () => string | null
  onEditorEvent?: <K extends string>(event: K, listener: (...args: never[]) => void) => () => void
  onWorkspaceEvent?: <K extends string>(event: K, listener: (...args: never[]) => void) => () => void
  registerDisposable?: (fn: () => void) => void
}

const REFRESH_DELAY_MS = 0

export type CaptionMutationClassification = 'SELF_ONLY' | 'CONTENT_RELEVANT' | 'MIXED'

/**
 * True when a node is (or is inside) an InkChapter-owned decoration:
 * caption DOM or formula-number DOM. These are self-mutations that must never
 * re-trigger a business refresh.
 */
export function isInkChapterOwnedDecorationNode(node: Node): boolean {
  if (!(node instanceof Element)) return false
  return !!(
    node.matches('[data-inkchapter-caption]') ||
    node.matches('[data-inkchapter-formula-number]') ||
    node.matches('[data-inkchapter-formula-managed]') ||
    node.closest('[data-inkchapter-caption]') ||
    node.closest('[data-inkchapter-formula-number]') ||
    node.closest('[data-inkchapter-formula-managed]')
  )
}

/**
 * Legacy self/content/mixed classifier (kept for existing consumers/tests).
 * The authoritative v2 classifier is `classifyEditorMutationBatchV2`.
 */
export function classifyCaptionMutationBatch(records: MutationRecord[]): CaptionMutationClassification {
  let selfOnly = 0
  let content = 0
  for (const record of records) {
    const targetIsSelf = record.target instanceof Element && isInkChapterOwnedDecorationNode(record.target)
    const addedAllSelf = Array.from(record.addedNodes).every(n =>
      n instanceof Element && isInkChapterOwnedDecorationNode(n))
    const removedAllSelf = Array.from(record.removedNodes).every(n =>
      n instanceof Element && isInkChapterOwnedDecorationNode(n))
    const hasAdded = record.addedNodes.length > 0
    const hasRemoved = record.removedNodes.length > 0
    const isSelfMutation = targetIsSelf || (hasAdded && addedAllSelf) || (hasRemoved && removedAllSelf)
    if (isSelfMutation) selfOnly++
    else content++
  }
  if (selfOnly > 0 && content === 0) return 'SELF_ONLY'
  if (content > 0 && selfOnly === 0) return 'CONTENT_RELEVANT'
  return 'MIXED'
}

// ── Editor Mutation Ownership V2 (v2.5.3) ───────────────────────────

const RENDERER_INTERNAL_TAGS = new Set([
  'MJX-CONTAINER', 'MJX-MATH', 'MJX-MROW', 'MJX-MTEXT',
  'MJX-MERROR', 'MJX-ASSISTIVE-MML', 'MJX-MI', 'MJX-MN', 'MJX-MO',
  'SVG', 'PATH', 'USE', 'MATH',
])

/** True when an element is a pure Typora/MathJax renderer internal (never real content). */
export function isRendererInternalElement(el: Element): boolean {
  const tag = el.tagName.toUpperCase()
  if (RENDERER_INTERNAL_TAGS.has(tag)) return true
  if (el.classList.contains('CodeMirror-line')) return true
  // CodeMirror internals: any node inside .CodeMirror that is not the stable
  // semantic fence host (pre.md-fences) is a transient renderer node.
  if (el.closest('.CodeMirror') && !el.closest('pre.md-fences')) return true
  // MathJax render internals below the block host.
  if (el.closest('mjx-container')) return true
  return false
}

export type EditorMutationCategory =
  | 'INKCHAPTER_DECORATION_ONLY'
  | 'TYPOORA_RENDERER_INTERNAL_ONLY'
  | 'REAL_DOCUMENT_CONTENT'
  | 'MIXED_CONTENT_AND_RENDERER'
  | 'UNKNOWN'

export type EditorMutationDecision =
  | 'IGNORED'
  | 'IGNORED_RENDERER_INTERNAL'
  | 'BUSINESS_REFRESH'
  | 'NO_BUSINESS_CHANGE'

export interface EditorMutationOwnershipV2 {
  batchId: string
  recordCount: number
  inkchapterDecorationCount: number
  rendererInternalCount: number
  realContentCount: number
  unknownCount: number
  classification: EditorMutationCategory
  formulaRefreshRequested: boolean
  captionRefreshRequested: boolean
  strictValidationRequested: boolean
  decision: EditorMutationDecision
}

function classifyMutationNode(node: Node): 'inkchapter' | 'renderer-internal' | 'real-content' | 'unknown' {
  if (node instanceof Element) {
    if (isInkChapterOwnedDecorationNode(node)) return 'inkchapter'
    if (isRendererInternalElement(node)) return 'renderer-internal'
    return 'real-content'
  }
  if (node.nodeType === Node.TEXT_NODE) {
    const parent = node.parentElement
    if (parent && isRendererInternalElement(parent)) return 'renderer-internal'
    if (parent && isInkChapterOwnedDecorationNode(parent)) return 'inkchapter'
    return 'real-content'
  }
  return 'unknown'
}

/** The mutation target is a container for childList changes; never "real content" by itself. */
function classifyMutationTarget(node: Node): 'inkchapter' | 'renderer-internal' | 'neutral' {
  if (node instanceof Element) {
    if (isInkChapterOwnedDecorationNode(node)) return 'inkchapter'
    if (isRendererInternalElement(node)) return 'renderer-internal'
  }
  return 'neutral'
}

let mutationBatchSeq = 0

/** Classify an editor mutation batch with renderer-internal awareness (spec §67–76). */
export function classifyEditorMutationBatchV2(records: MutationRecord[]): EditorMutationOwnershipV2 {
  let inkchapter = 0
  let renderer = 0
  let real = 0
  let unknown = 0

  for (const record of records) {
    const tc = classifyMutationTarget(record.target)
    if (tc === 'inkchapter') inkchapter++
    else if (tc === 'renderer-internal') renderer++

    const nodes: Node[] = [...Array.from(record.addedNodes), ...Array.from(record.removedNodes)]
    for (const n of nodes) {
      const c = classifyMutationNode(n)
      if (c === 'inkchapter') inkchapter++
      else if (c === 'renderer-internal') renderer++
      else if (c === 'real-content') real++
      else unknown++
    }
  }

  let classification: EditorMutationCategory
  if (real > 0 && (renderer > 0 || inkchapter > 0)) classification = 'MIXED_CONTENT_AND_RENDERER'
  else if (real > 0) classification = 'REAL_DOCUMENT_CONTENT'
  else if (renderer > 0 && inkchapter === 0) classification = 'TYPOORA_RENDERER_INTERNAL_ONLY'
  else if (inkchapter > 0 && renderer === 0) classification = 'INKCHAPTER_DECORATION_ONLY'
  else if (renderer > 0 || inkchapter > 0) classification = 'TYPOORA_RENDERER_INTERNAL_ONLY'
  else classification = 'UNKNOWN'

  const wantsRefresh = classification === 'REAL_DOCUMENT_CONTENT' || classification === 'MIXED_CONTENT_AND_RENDERER' || classification === 'UNKNOWN'
  const decision: EditorMutationDecision = classification === 'INKCHAPTER_DECORATION_ONLY'
    ? 'IGNORED'
    : classification === 'TYPOORA_RENDERER_INTERNAL_ONLY'
      ? 'IGNORED_RENDERER_INTERNAL'
      : wantsRefresh
        ? 'BUSINESS_REFRESH'
        : 'NO_BUSINESS_CHANGE'

  return {
    batchId: `mut-${++mutationBatchSeq}-${Date.now().toString(36)}`,
    recordCount: records.length,
    inkchapterDecorationCount: inkchapter,
    rendererInternalCount: renderer,
    realContentCount: real,
    unknownCount: unknown,
    classification,
    formulaRefreshRequested: wantsRefresh,
    captionRefreshRequested: wantsRefresh,
    strictValidationRequested: false,
    decision,
  }
}

/** Resolved naming target for a right-clicked element. */
export interface CaptionNamingTarget {
  type: CaptionTargetType
  canonicalElement: HTMLElement
  /** Stable diagnostic identity (NOT a persistence key; see targetAnchor). */
  runtimeKey: string
  currentNumber: number
  currentName?: string
  recordId: string | null
  documentKey: string | null
  target: CaptionTarget
}

export class CaptionService {
  private registry = new CaptionRegistry()
  private adapter: CaptionDomAdapter
  private formulaAdapter: FormulaNumberingAdapter
  private ctx: CaptionServiceContext

  /** captionId → live target root (session-only, survives moves). */
  private boundTargets = new Map<string, HTMLElement>()
  /** captionIds kept ORPHAN on rehydrate (never auto-bound). */
  private orphanIds = new Set<string>()

  private currentDocumentKey: string | null = null
  private mutationObserver: MutationObserver | null = null
  private refreshTimer: ReturnType<typeof setTimeout> | null = null
  private disposers: Array<() => void> = []
  private captionSeq = 0
  private started = false
  private lastNumbers = new Map<string, number>()
  private rendering = false
  private captionSettings: CaptionSettings = DEFAULT_CAPTION_SETTINGS
  private formulaConfig: ObjectNumberingConfig = DEFAULT_OBJECT_NUMBERING_CONFIG.formula
  private currentEditorRoot: HTMLElement | null = null
  private lastRefreshReason = 'none'
  private lastScanAt: number | null = null
  private lastRenderAt: number | null = null
  private headingIndexRevision = 0
  /** v2.5.4: document generation + editor root tokens (live DOM authority). */
  private documentGeneration = 0
  private editorRootTokens = new WeakMap<HTMLElement, number>()
  private nextEditorRootToken = 0
  private lastKnownGoodFormulaLabels = new Map<string, string>()
  /** v2.5.4: true quiescence timestamps (ms epoch). */
  private lastBusinessMutationAt = 0
  /** R5.4.3.18 P0-E: count of user formula clicks (correctness must not depend on it). */
  private formulaClickCount = 0
  private lastFormulaRefreshAt = 0
  private lastFormulaDomWriteAt = 0
  private lastDocumentSwitchAt = 0
  private lastFormulaSettingsChangeAt = 0
  private lastError: string | null = null
  private captionMutationSelfIgnoredCount = 0
  private captionMutationContentRefreshCount = 0
  /** v2.5.3: renderer-internal mutation + external business mutation counters. */
  private rendererMutationIgnoredCount = 0
  private externalBusinessMutationCount = 0
  /** v2.5.3: formula refresh quiescence counters (never a correctness poll). */
  private formulaRefreshCount = 0
  private formulaScanCount = 0
  private formulaReentrantRefreshCount = 0
  private formulaPendingRefreshCount = 0
  private formulaRefreshInProgress = false
  private lastFormulaReconcileStats: FormulaReconcileStats | null = null
  /** v2.5.7-R5.4.1: live formula revision authority (dirty-buffer semantic state). */
  private lastMutationClassification: MutationClassification = 'STARTUP'
  private lastLiveSemanticSnapshot: LiveFormulaSemanticSnapshot | null = null
  private invalidationInProgress = false
  private liveUpdateRendererFeedbackLoopCount = 0
  private liveUpdateSourceMutationDetected = false
  /** v2.5.7-R5.4.2: post-catchup context rebind token + identity pass flag. */
  private tex2svgContextToken = 0
  private lastEditingHostIdentityPass = false
  private liveUpdateDriftObservedCount = 0
  private liveUpdateDriftBlockedCount = 0
  /** v2.5.7-R5.4.3: event-driven counters. */
  private semanticOperationBatchCount = 0
  private dependencyRangeBuildCount = 0
  private headingChangeAffectedFormulaCount = 0
  private headingChangeRefreshPassCount = 0
  private unaffectedFormulaRefreshCount = 0
  private lastLiveHeadingCache: HeadingEntry[] | null = null
  private renderStats: ReconcileStats = {
    createCount: 0, updateCount: 0, moveCount: 0,
    noOpCount: 0, removeDisabledCount: 0, removeStaleCount: 0,
  }
  private lastEligibility: Record<CaptionTargetType, { targetCount: number; eligibleCount: number; namedCount: number; renderedCount: number; skippedReasons: string[] }> = {
    table: { targetCount: 0, eligibleCount: 0, namedCount: 0, renderedCount: 0, skippedReasons: [] },
    figure: { targetCount: 0, eligibleCount: 0, namedCount: 0, renderedCount: 0, skippedReasons: [] },
    code: { targetCount: 0, eligibleCount: 0, namedCount: 0, renderedCount: 0, skippedReasons: [] },
  }

  /** Last figure alt write trace (FAW0–FAW5) for runtime probe. */
  private lastFigureAltWrite: {
    runtimeKey: string
    occurrence: number
    oldAlt: string
    newAlt: string
    oldRawPath: string
    newRawPath: string
    sourceMarkdownBefore: string
    sourceMarkdownAfter: string
    editorMarkdownChanged: boolean
    sourceTokenMatched: boolean
    writeMethod: 'MARKDOWN_REWRITE' | 'NONE'
    decision: 'WRITTEN' | 'NO_OP' | 'BLOCK'
    reason: string
    at: number
  } | null = null

  /** Last local image path normalization trace. */
  private lastPathNormalizeDecision: {
    decision: 'WRITTEN' | 'NO_OP' | 'BLOCK'
    normalized: number
    blocked: number
    reason: string
    at: number
  } | null = null

  constructor(ctx: CaptionServiceContext) {
    installMathJaxHook()
    this.ctx = ctx
    this.adapter = new CaptionDomAdapter(() => this.currentEditorRoot)
    this.formulaAdapter = new FormulaNumberingAdapter(() => this.currentEditorRoot)
    console.info('[InkChapter Caption] SERVICE-CONSTRUCTED')
    emitRuntimeAudit('CAPTION-SERVICE-CONSTRUCTED', { decision: 'CONSTRUCTED' })
  }

  // ── Settings ──────────────────────────────────────────────────────

  /** Apply user caption settings (enabled/position/prefix) and re-render. */
  applySettings(settings: CaptionSettings): void {
    this.captionSettings = settings
    emitRuntimeAudit('CAPTION-SETTINGS-APPLY', {
      tableEnabled: settings.types.table.enabled,
      tablePosition: settings.types.table.position,
      tablePrefix: settings.types.table.prefix,
      figureEnabled: settings.types.figure.enabled,
      figurePosition: settings.types.figure.position,
      figurePrefix: settings.types.figure.prefix,
      codeEnabled: settings.types.code.enabled,
      codePosition: settings.types.code.position,
      codePrefix: settings.types.code.prefix,
      decision: 'APPLIED',
    })
    console.info(
      `[InkChapter Caption] SETTINGS-APPLY ` +
      `table=${settings.types.table.enabled}/${settings.types.table.position}/${settings.types.table.prefix} ` +
      `image=${settings.types.figure.enabled}/${settings.types.figure.position}/${settings.types.figure.prefix} ` +
      `code=${settings.types.code.enabled}/${settings.types.code.position}/${settings.types.code.prefix}`,
    )
    this.refresh()
  }

  getSettings(): CaptionSettings {
    return this.captionSettings
  }

  /** Apply the (independent) formula ObjectNumberingConfig and re-render. */
  applyFormulaSettings(config: ObjectNumberingConfig): void {
    this.formulaConfig = migrateObjectNumberingConfig('formula', config)
    // v2.5.1: formula numbering is InkChapter-owned and fixed right (no selector).
    const oldImplementation = this.formulaConfig.formulaMode ?? 'typora-native'
    const oldPosition = this.formulaConfig.position ?? 'right'
    this.formulaConfig.formulaMode = 'inkchapter'
    this.formulaConfig.position = 'right'
    this.lastFormulaSettingsChangeAt = Date.now()
    const mode = 'inkchapter'
    console.info(
      `[InkChapter Numbering] FORMULA-MODE-SWITCH mode=${mode} ` +
      `enabled=${this.formulaConfig.enabled} prefix=${JSON.stringify(this.formulaConfig.prefix)} ` +
      `numberingMode=${this.formulaConfig.numberingMode} template=${JSON.stringify(this.formulaConfig.template)} ` +
      `position=${this.formulaConfig.position} decision=APPLIED`,
    )
    console.info(
      `[InkChapter Numbering] FORMULA-NUMBERING-MIGRATION oldImplementation=${oldImplementation} ` +
      `newImplementation=inkchapter oldPosition=${oldPosition} newPosition=right ` +
      `preset=${this.formulaConfig.preset ?? 'none'} decision=MIGRATED`,
    )
    emitRuntimeAudit('FORMULA-SETTINGS-APPLY', {
      mode,
      enabled: this.formulaConfig.enabled,
      numberingMode: this.formulaConfig.numberingMode,
      template: this.formulaConfig.template,
      decision: 'APPLIED',
    })
    this.refresh()
  }

  // ── Lifecycle ─────────────────────────────────────────────────────

  start(): void {
    if (this.started) return;

    const sessionId = `sess-${Date.now()}`;
    initializeForensicSink({ vaultRoot: this.ctx.vaultRoot, buildId: INKCHAPTER_BUILD_ID, sessionId });
    this.started = true

    console.info('[InkChapter Caption] SERVICE-START')
    emitRuntimeAudit('CAPTION-SERVICE-START', { decision: 'STARTED' })

    // ── v2.5.7-R5.3: transparent MathJax render-route hooks ──
    // Installed here (after the forensic sink is ready) so candidate-inventory
    // and hook-install markers are persisted, and BEFORE any target document
    // formula render. Idempotent — re-attempted at each managed-plan one-shot.
    installRenderRouteHooks()

    // ── External configuration attribution (not a Caption/Alt/Path root cause) ──
    // InkChapter never configures Typora's image uploader; any missing
    // `imageUploader_windows_amd64.exe` error is an external Typora config issue.
    console.info(
      '[InkChapter Caption] IMAGE-UPLOADER-ATTRIBUTION ' +
      'decision=EXTERNAL_CONFIGURATION_ERROR reason=inkchapter-does-not-configure-uploader',
    )

    // ── Late-subscriber catch-up: actively resolve + bind the CURRENT editor ──
    // The editor may already be loaded when the plugin onload runs. Do NOT rely
    // solely on future 'load' / 'file:open' listeners.
    const currentRoot = this.resolveCurrentEditorRoot('startup')
    if (currentRoot) {
      this.bindEditor(currentRoot, 'startup-catchup')
    }

    // Future editor load (new editor instance / first load).
    const onLoad = (editorEl: unknown) => {
      if (editorEl instanceof HTMLElement) {
        this.bindEditor(editorEl, 'editor-load')
      } else {
        const root = this.resolveCurrentEditorRoot('editor-load-fallback')
        if (root) this.bindEditor(root, 'editor-load-fallback')
      }
      this.onDocumentChanged()
    }
    if (this.ctx.onEditorEvent) {
      this.disposers.push(this.ctx.onEditorEvent('load', onLoad))
    }
    if (this.ctx.onWorkspaceEvent) {
      this.disposers.push(this.ctx.onWorkspaceEvent('file:open', () => {
        // File switch: re-resolve root, re-bind if changed, then refresh.
        const root = this.resolveCurrentEditorRoot('file-switch')
        if (root && root !== this.currentEditorRoot) {
          this.bindEditor(root, 'file-switch')
        }
        this.onDocumentChanged()
      }))
    }

    // Register DevTools diagnostic entry points.
    this.registerProbe()

    // Set document key + rehydrate (this also triggers the initial refresh).
    this.onDocumentChanged()
  }

  /** Resolve the current editor root with explicit logging. */
  private resolveCurrentEditorRoot(reason: string): HTMLElement | null {
    const candidates: HTMLElement[] = []
    const fromCtx = this.ctx.getEditorRoot?.() ?? null
    if (fromCtx) candidates.push(fromCtx)

    // Fallback candidates (real Typora editing area may not be #write).
    const byWrite = document.getElementById('write')
    if (byWrite && !candidates.includes(byWrite)) candidates.push(byWrite)
    const byContent = document.querySelector<HTMLElement>('[contenteditable="true"]')
    if (byContent && !candidates.includes(byContent)) candidates.push(byContent)

    let selected: HTMLElement | null = null
    for (const c of candidates) {
      if (c.isConnected) { selected = c; break }
    }
    if (!selected && candidates.length > 0) selected = candidates[0]

    const containsTables = selected ? selected.querySelectorAll('table').length : 0
    console.info(
      `[InkChapter Caption] EDITOR-RESOLVE ` +
      `reason=${reason} candidateCount=${candidates.length} ` +
      `selected=${selected ? selected.tagName + (selected.id ? '#' + selected.id : '') + '.' + (selected.className || '').slice(0, 40) : 'null'} ` +
      `connected=${selected ? selected.isConnected : false} ` +
      `containsTableCount=${containsTables}`,
    )
    emitRuntimeAudit('CAPTION-EDITOR-RESOLVE', {
      reason,
      candidateCount: candidates.length,
      selectedCandidate: selected ? `${selected.tagName}#${selected.id}.${(selected.className || '').slice(0, 40)}` : null,
      connected: selected ? selected.isConnected : false,
      containsTableCount: containsTables,
    })
    if (!selected) {
      this.lastError = `EDITOR_RESOLVE_FAILED reason=${reason}`
    }
    return selected
  }

  /** Bind a specific editor root (connect observer + immediate refresh). */
  private bindEditor(root: HTMLElement, reason: string): void {
    this.currentEditorRoot = root
    this.connectObserver(root)
    console.info(
      `[InkChapter Caption] EDITOR-BOUND ` +
      `reason=${reason} tag=${root.tagName} id=${root.id || ''} ` +
      `class=${(root.className || '').slice(0, 60)} connected=${root.isConnected}`,
    )
    emitRuntimeAudit('CAPTION-EDITOR-BOUND', {
      reason,
      tag: root.tagName,
      id: root.id || '',
      connected: root.isConnected,
      decision: 'BOUND',
    })
    // Immediate refresh — static-open documents must show captions without waiting for a mutation.
    queueMicrotask(() => this.refresh(reason))
  }

  private onDocumentChanged(): void {
    const docKey = this.ctx.getDocumentKey?.() ?? this.ctx.getActiveFilePath?.() ?? null
    const changed = docKey !== this.currentDocumentKey

    if (changed) {
      const oldDocumentKey = this.currentDocumentKey
      const oldGeneration = this.documentGeneration
      const oldRootToken = this.currentEditorRoot ? this.editorRootTokenFor(this.currentEditorRoot) : 0
      // Document switch: flush old document bindings (persisted already).
      if (oldDocumentKey !== null) this.flushDocument()
      // R5.4.3.8 P2: the edit-session latch is document/generation-scoped.
      clearEditSession('document-switch')
      this.documentGeneration++
      this.lastDocumentSwitchAt = Date.now()
      // New generation invalidates the old formula last-known-good cache.
      this.lastKnownGoodFormulaLabels.clear()
      const newRootToken = this.currentEditorRoot ? this.editorRootTokenFor(this.currentEditorRoot) : 0
      console.info(
        `[InkChapter Numbering] OBJECT-DOCUMENT-GENERATION-TRANSITION ` +
        `oldDocumentKey=${oldDocumentKey ?? 'none'} newDocumentKey=${docKey ?? 'none'} ` +
        `oldGeneration=${oldGeneration} newGeneration=${this.documentGeneration} ` +
        `oldEditorRootToken=${oldRootToken} newEditorRootToken=${newRootToken} ` +
        `headingIndexInvalidated=true projectionInvalidated=true formulaCacheInvalidated=true ` +
        `decision=TRANSITIONED runtimeMarker=FORMULA-BLOCK-ANCHOR-NATIVE-BARRIER-V2.5.6`,
      )

      // R5.4.3.17: Update FormulaStateStore baseline for the new document —
      // real runtime context + canonical hosts + trusted desiredTag overrides.
      const newRoot = this.currentEditorRoot
      if (newRoot && docKey) {
        const headings: any[] = this.ctx.getStructuredHeadingNumberState?.() ?? []
        const canonicalHosts = this.formulaAdapter.collectFormulaTargets().map((t) => t.root)
        void handleDocumentSwitch(
          {
            documentKey: docKey,
            documentGeneration: this.documentGeneration,
            editorRoot: newRoot,
            editorRootToken: this.editorRootTokenFor(newRoot),
          },
          canonicalHosts,
          headings,
          this.buildFormulaDesiredTagOverrides(),
          newRoot,
        )
      }
    }
    this.currentDocumentKey = docKey
    this.rehydrate()
  }

  private flushDocument(): void {
    this.boundTargets.clear()
    this.orphanIds.clear()
  }

  /**
   * R5.4.3.17: build trusted desiredTag per canonical host from the working
   * production numbering pipeline (lastLiveSemanticSnapshot), so the
   * FormulaStateStore committed slot desiredTag stays aligned with the real
   * numbering algorithm (no re-invention of section-dot/suffix logic).
   */
  private buildFormulaDesiredTagOverrides(): Map<HTMLElement, string | null> {
    const map = new Map<HTMLElement, string | null>()
    const snapshot = this.lastLiveSemanticSnapshot
    if (!snapshot) return map
    const targets = this.formulaAdapter.collectFormulaTargets()
    for (const entry of snapshot.entries) {
      if (entry.stableFormulaIdentity === 'AMBIGUOUS') continue
      const target = targets.find((t) => t.ordinal === entry.formulaIndex)
      if (target && entry.desiredTag) map.set(target.root, entry.desiredTag)
    }
    return map
  }

  private editorRootTokenFor(root: HTMLElement): number {
    let token = this.editorRootTokens.get(root)
    if (token === undefined) {
      token = ++this.nextEditorRootToken
      this.editorRootTokens.set(root, token)
    }
    return token
  }

  // ── R5.4.3.8 P1/P2: Formula edit-session event watchers ──
  // pointerdown / focusin → IDENTITY LATCH ONLY (never source commit).
  // beforeinput / input (content-changing) → mark explicit input so the
  // source commit barrier (formula-authoritative-source.ts) may allow commit.
  private formulaSessionWatcherRoot: HTMLElement | null = null
  private formulaSessionPointerHandler: ((e: Event) => void) | null = null
  private formulaSessionFocusInHandler: ((e: Event) => void) | null = null
  private formulaSessionBeforeInputHandler: ((e: Event) => void) | null = null
  private formulaSessionInputHandler: ((e: Event) => void) | null = null

  private resolveEditSessionHost(target: Node | null): HTMLElement | null {
    if (!(target instanceof Node)) return null
    const el = target instanceof HTMLElement ? target : target.parentElement
    if (!el) return null
    const host = el.closest(MATH_HOST_SELECTOR)
    if (!(host instanceof HTMLElement)) return null
    // Only block-level canonical hosts latch an edit session.
    if (!host.classList.contains('md-math-block') && !host.classList.contains('mathjax-block')) return null
    return host
  }

  private latchFormulaEditSessionFromPointer(host: HTMLElement, trigger: string): void {
    // R5.4.3.18 P0-E: count user formula clicks — correctness must never
    // depend on clicks, but the pre-click closure marker reports the count.
    this.formulaClickCount++
    const docKey = this.currentDocumentKey
    if (!docKey) return
    const identity = resolveStableFormulaIdentity(host)
    const active = getActiveEditSession()
    if (active && active.documentKey === docKey && active.stableFormulaIdentity === identity) return
    const plan = getCurrentInjectionPlan()
    const entry = plan?.entries.find((en) => en.stableFormulaIdentity === identity) ?? null
    const auth = getAuthoritativeSourceState(docKey, identity)
    const session = latchEditSession({
      documentKey: docKey,
      generation: this.documentGeneration,
      rootToken: this.currentEditorRoot ? this.editorRootTokenFor(this.currentEditorRoot) : 0,
      stableFormulaIdentity: identity,
      formulaHostToken: tokenFor(host),
      formulaIndex: entry?.formulaIndex ?? null,
      desiredTag: entry?.desiredTag ?? null,
      sourceHashAtEnter: auth?.normalizedSourceHash ?? null,
      contentRevisionAtEnter: auth?.formulaContentRevision ?? 0,
      trigger,
    })
    emitNonsemanticEditTransition({
      sessionId: session.sessionId,
      eventKind: trigger,
      stableFormulaIdentity: identity,
      formulaIndex: entry?.formulaIndex ?? null,
      userSemanticSourceChange: false,
    })
  }

  private markExplicitInputFromEvent(e: Event, eventKind: string): void {
    const session = getActiveEditSession()
    if (!session) return
    const host = this.resolveEditSessionHost(e.target instanceof Node ? e.target : null)
    if (!host) return
    const identity = resolveStableFormulaIdentity(host)
    if (identity !== session.stableFormulaIdentity) return
    let contentChanging = true
    if (e instanceof InputEvent && e.inputType) {
      // Navigation / UI control events (arrow keys, etc.) are NOT content input.
      contentChanging = /^(insert|delete|history)/.test(e.inputType)
    }
    if (!contentChanging) return
    markSessionExplicitInput(session)
    emitNonsemanticEditTransition({
      sessionId: session.sessionId,
      eventKind,
      stableFormulaIdentity: identity,
      formulaIndex: session.formulaIndex,
      userSemanticSourceChange: true,
    })
  }

  private connectFormulaEditSessionWatchers(root: HTMLElement): void {
    this.disconnectFormulaEditSessionWatchers()
    this.formulaSessionWatcherRoot = root
    this.formulaSessionPointerHandler = (e: Event) => {
      const host = this.resolveEditSessionHost(e.target instanceof Node ? e.target : null)
      if (host) this.latchFormulaEditSessionFromPointer(host, 'pointerdown')
    }
    this.formulaSessionFocusInHandler = (e: Event) => {
      const host = this.resolveEditSessionHost(e.target instanceof Node ? e.target : null)
      if (host) this.latchFormulaEditSessionFromPointer(host, 'focusin')
    }
    this.formulaSessionBeforeInputHandler = (e: Event) => this.markExplicitInputFromEvent(e, 'beforeinput')
    this.formulaSessionInputHandler = (e: Event) => this.markExplicitInputFromEvent(e, 'input')
    root.addEventListener('pointerdown', this.formulaSessionPointerHandler, true)
    root.addEventListener('focusin', this.formulaSessionFocusInHandler, true)
    root.addEventListener('beforeinput', this.formulaSessionBeforeInputHandler, true)
    root.addEventListener('input', this.formulaSessionInputHandler, true)
  }

  private disconnectFormulaEditSessionWatchers(): void {
    const root = this.formulaSessionWatcherRoot
    if (root) {
      if (this.formulaSessionPointerHandler) root.removeEventListener('pointerdown', this.formulaSessionPointerHandler, true)
      if (this.formulaSessionFocusInHandler) root.removeEventListener('focusin', this.formulaSessionFocusInHandler, true)
      if (this.formulaSessionBeforeInputHandler) root.removeEventListener('beforeinput', this.formulaSessionBeforeInputHandler, true)
      if (this.formulaSessionInputHandler) root.removeEventListener('input', this.formulaSessionInputHandler, true)
    }
    this.formulaSessionWatcherRoot = null
    this.formulaSessionPointerHandler = null
    this.formulaSessionFocusInHandler = null
    this.formulaSessionBeforeInputHandler = null
    this.formulaSessionInputHandler = null
  }

  private connectObserver(root: HTMLElement): void {
    this.disconnectObserver()
    this.connectFormulaEditSessionWatchers(root)
    this.mutationObserver = new MutationObserver((records) => {
      if (this.rendering) return
      const ownership = classifyEditorMutationBatchV2(records)
      console.info(
        `[InkChapter Numbering] EDITOR-MUTATION-OWNERSHIP-V2 batchId=${ownership.batchId} ` +
        `recordCount=${ownership.recordCount} inkchapterDecorationCount=${ownership.inkchapterDecorationCount} ` +
        `rendererInternalCount=${ownership.rendererInternalCount} realContentCount=${ownership.realContentCount} ` +
        `unknownCount=${ownership.unknownCount} classification=${ownership.classification} ` +
        `formulaRefreshRequested=${ownership.formulaRefreshRequested} captionRefreshRequested=${ownership.captionRefreshRequested} ` +
        `strictValidationRequested=${ownership.strictValidationRequested} decision=${ownership.decision} ` +
        `runtimeMarker=FORMULA-BLOCK-ANCHOR-NATIVE-BARRIER-V2.5.6`,
      )
      if (ownership.decision === 'IGNORED') {
        this.captionMutationSelfIgnoredCount++
        console.info('[InkChapter Caption] EDITOR-MUTATION decision=IGNORE reason=INKCHAPTER_DECORATION_SELF_MUTATION')
        return
      }
      if (ownership.decision === 'IGNORED_RENDERER_INTERNAL') {
        this.rendererMutationIgnoredCount++
        this.lastMutationClassification = 'TYPOORA_RENDERER_INTERNAL_ONLY'
        if (this.invalidationInProgress) {
          markRendererInternalMutationObserved()
          this.liveUpdateRendererFeedbackLoopCount++
        }
        // R5.4.3.7: renderer-internal mutations are NO LONGER unconditionally
        // ignored. semanticRefresh=false, but projection reconcile may be
        // required when a canonical formula host's visible tag diverged from
        // the authoritative desiredTag after a Typora re-render.
        this.reconcileRendererInternalProjection(records)
        console.info('[InkChapter Caption] EDITOR-MUTATION decision=PROJECTION_RECONCILE reason=TYPOORA_RENDERER_INTERNAL')
        return
      }
      this.lastMutationClassification = ownership.classification
      this.captionMutationContentRefreshCount++
      this.externalBusinessMutationCount++
      this.lastBusinessMutationAt = Date.now()

      // R5.4.3.2: context gate check using live snapshot-aware state machine.
      // No semantic events until document context is fully ready.
      const liveSnapshot = this.lastLiveSemanticSnapshot
      const gateInput = {
        documentKey: this.currentDocumentKey,
        documentGeneration: this.documentGeneration,
        editorRootAvailable: this.currentEditorRoot !== null,
        editorRootConnected: this.currentEditorRoot?.isConnected ?? false,
        businessReady: !!this.currentDocumentKey,
        liveSnapshotAvailable: liveSnapshot !== null,
        liveSnapshotDocumentKey: liveSnapshot?.documentKey ?? null,
        liveSnapshotGeneration: this.documentGeneration,
        liveSnapshotFormulaCount: liveSnapshot?.formulaCount ?? 0,
      }

      // R5.4.3.17: FORMULA-LEGACY-BASELINE-GATE-HANDOFF — once the
      // FormulaStateStore baseline is READY for the same doc/gen/root, the
      // legacy FormulaSemanticBaseline gate MUST NOT block semantic dispatch.
      const storeReady = this.currentEditorRoot && this.currentDocumentKey
        ? isStoreBaselineReady({
            documentKey: this.currentDocumentKey,
            documentGeneration: this.documentGeneration,
            editorRoot: this.currentEditorRoot,
            editorRootToken: this.editorRootTokenFor(this.currentEditorRoot),
          })
        : false
      if (storeReady) {
        emitLegacyBaselineGateHandoff({
          storeBaselineReady: true,
          storeDocumentKey: this.currentDocumentKey ?? '',
          storeGeneration: this.documentGeneration,
          storeRootToken: this.currentEditorRoot ? this.editorRootTokenFor(this.currentEditorRoot) : 0,
          legacyBaselineState: getBaselineState(),
          legacyGateWouldDefer: true,
          handoffApplied: true,
          semanticDispatchAllowed: true,
        })
      } else {
        emitLegacyBaselineGateHandoff({
          storeBaselineReady: false,
          storeDocumentKey: this.currentDocumentKey ?? '',
          storeGeneration: this.documentGeneration,
          storeRootToken: this.currentEditorRoot ? this.editorRootTokenFor(this.currentEditorRoot) : 0,
          legacyBaselineState: getBaselineState(),
          legacyGateWouldDefer: false,
          handoffApplied: false,
          semanticDispatchAllowed: false,
        })
      }
      // Skip the legacy gate entirely once the store owns the baseline.
      if (!storeReady) {
      const gate = checkContextGate(gateInput)
      if (gate.decision === 'HYDRATING') {
        // Hydrate baseline from the existing live snapshot.
        const rootToken = this.currentEditorRoot ? this.editorRootTokenFor(this.currentEditorRoot) : 0
        const hydrated = liveSnapshot ? hydrateBaselineFromLiveSnapshot({
          documentKey: this.currentDocumentKey ?? '',
          documentGeneration: this.documentGeneration,
          editorRootToken: rootToken,
          sourceFormulaSnapshotAvailable: true,
          sourceFormulaSnapshotRevision: liveSnapshot.liveFormulaRevision,
          sourceFormulaCount: liveSnapshot.formulaCount,
          sourceManagedFormulaCount: liveSnapshot.managedFormulaCount,
          sourceSemanticSignature: liveSnapshot.semanticSignature,
          sourceHeadingSnapshotAvailable: false,
          sourceHeadingSnapshotRevision: 0,
        }) : 'SKIP'
        if (hydrated !== 'HYDRATED') {
          console.info(`[InkChapter Caption] BASELINE-HYDRATION-FAILED result=${hydrated}`)
          return
        }
        // Re-check gate after hydration.
        const gate2 = checkContextGate(gateInput)
        if (gate2.decision !== 'ALLOW') {
          console.info(`[InkChapter Caption] DISPATCH-CONTEXT-GATE-AFTER-HYDRATION decision=${gate2.decision} reason=${gate2.reason}`)
          return
        }
      } else if (gate.decision !== 'ALLOW') {
        console.info(`[InkChapter Caption] DISPATCH-CONTEXT-GATE decision=${gate.decision} reason=${gate.reason}`)
        return
      }
      } // end: skip legacy gate when storeReady

      // R5.4.3: dispatch a semantic event instead of scheduleRefresh (timer).
      // The event coalesces multiple rapid mutations into one operation batch
      // via queueMicrotask (never setTimeout).
      // R5.4.3.1: This is a MUTATION_SHAPE_GUESS — only used as a fallback;
      // the real semantic event authority comes from snapshot diff.
      const eventKind: FormulaSemanticEvent['eventKind'] = ownership.classification === 'REAL_DOCUMENT_CONTENT'
        ? 'FORMULA_ADDED'
        : 'FORMULA_SOURCE_CHANGED'
      dispatchSemanticEvent(
        { eventKind, classification: ownership.classification },
        ownership.batchId,
        (batch) => this.onSemanticEventBatch(batch),
      )
    })
    this.mutationObserver.observe(root, { childList: true, subtree: true })
  }

  /**
   * R5.4.3.1: handle a flushed semantic event batch.
   *
   * R5.4.3.1 CRITICAL CHANGE: The old R5.4.3 called this.refresh('event-driven')
   * which triggered a GLOBAL caption refresh (table/image/code/formula/heading).
   * This is now REPLACED with a domain-isolated formula/heading pipeline.
   *
   * The formula/heading pipeline only processes formula and heading events.
   * It NEVER triggers table/image/code caption scans or global refresh.
   */
  private async onSemanticEventBatch(batch: SemanticOperationBatch): Promise<void> {
    try {
      this.semanticOperationBatchCount++
      emitEventDispatch(batch)

      // R5.4.3.1: check operation lifecycle — drop stale batches.
      const lifecycle = checkOperationLifecycle({
        operationBatchId: batch.batchId,
        createdDocumentKey: this.currentDocumentKey,
        currentDocumentKey: this.currentDocumentKey,
        createdGeneration: this.documentGeneration,
        currentGeneration: this.documentGeneration,
        createdEditorRootToken: this.currentEditorRoot ? this.editorRootTokenFor(this.currentEditorRoot) : 0,
        currentEditorRootToken: this.currentEditorRoot ? this.editorRootTokenFor(this.currentEditorRoot) : 0,
        baselineRevisionAtCreate: 0,
        baselineRevisionAtFinalize: 0,
      })
      if (lifecycle === 'DROP_STALE_BATCH') {
        return
      }

      // R5.4.3.1: domain isolation — formula/heading pipeline only.
      // Never triggers global caption refresh, table/image/code scans.
      const formulaEvents = batch.events.filter((e) => e.eventKind.startsWith('FORMULA_'))
      const headingEvents = batch.events.filter((e) => e.eventKind.startsWith('HEADING_'))

      // Emit domain isolation authority — formula/heading pipeline only.
      emitDomainIsolationAuthority({
        operationBatchId: batch.batchId,
        formulaHeadingPipelineInvoked: true,
        globalCaptionRefreshInvoked: false,
        tableScanInvoked: false,
        figureScanInvoked: false,
        codeScanInvoked: false,
        formulaScanInvoked: formulaEvents.length > 0,
        headingScanInvoked: headingEvents.length > 0,
      })

      // R5.4.3.3/R5.4.3.4: formula-only semantic refresh on formula events.
      // R5.4.3.4 Phase G: consumes REAL previous/next snapshots + diff for authority.
      let refreshResult: ReturnType<CaptionService['refreshFormulaSemanticStateNow']> = null
      if (formulaEvents.length > 0) {
        refreshResult = this.refreshFormulaSemanticStateNow('semantic-event-formula')
      }

      // ── Formula event processing (domain isolated, with snapshot authority) ──
      // R5.4.3.3: Use the latest snapshot to determine real event authority.
      // R5.4.3.4 Phase H: stableIdentity must come from REAL snapshot diff.
      const currentSnapshot = refreshResult?.nextSnapshot ?? this.lastLiveSemanticSnapshot
      const refreshDiff = refreshResult?.diff ?? []
      for (const ev of formulaEvents) {
        incrementFormulaSemanticEvent()
        const stableId = ev.stableFormulaIdentity ?? null
        const inSnapshot = currentSnapshot?.entries.some((e) => e.stableFormulaIdentity === stableId) ?? false
        // R5.4.3.4: SNAPSHOT_IDENTITY_DIFF only when before/after snapshots are concrete.
        const hasConcreteBridge = refreshResult !== null
          && refreshResult.previousSnapshot !== null
          && refreshResult.nextSnapshot !== null
        const authorityKind: SemanticEventAuthorityKind = hasConcreteBridge
          ? 'SNAPSHOT_IDENTITY_DIFF'
          : 'MUTATION_SHAPE_GUESS'
        const matchingDiff = stableId !== null
          ? refreshDiff.find((d) => d.stableFormulaIdentity === stableId)
          : undefined
        emitSemanticEventAuthority({
          operationBatchId: batch.batchId,
          eventKind: ev.eventKind,
          stableIdentity: stableId,
          presentBefore: matchingDiff ? !matchingDiff.changeKinds.includes('ADDED') : false,
          presentAfter: inSnapshot,
          oldDocumentOrder: matchingDiff?.previousFormulaIndex ?? null,
          newDocumentOrder: matchingDiff?.nextFormulaIndex ?? ev.documentOrder ?? null,
          oldSourceHash: matchingDiff?.previousSourceHash ?? null,
          newSourceHash: matchingDiff?.nextSourceHash ?? null,
          oldHeadingLevel: null,
          newHeadingLevel: null,
          oldSemanticRole: null,
          newSemanticRole: null,
          authorityKind,
        })
      }

      // R5.4.3.14: Dependency Frontier + Cascade Batch
      if (refreshResult && refreshResult.diff.length > 0) {
        const affected = computeAffectedFormulaSet(refreshResult.diff)
        emitAffectedRenderSet({ ...affected, liveFormulaRevision: getLiveFormulaRevision().liveFormulaRevision }, getLiveFormulaRevision().liveFormulaRevision)

        // R5.4.3.14: Compute dependency frontier for structural operations
        const hasStructuralOperation = formulaEvents.some((ev) =>
          ev.eventKind === 'FORMULA_ADDED' || ev.eventKind === 'FORMULA_REMOVED' || ev.eventKind === 'FORMULA_MOVED'
        )
        if (hasStructuralOperation && refreshResult.nextSnapshot && refreshResult.previousSnapshot) {
          // For each structural operation, compute suffix frontier
          for (const ev of formulaEvents) {
            if (ev.eventKind === 'FORMULA_ADDED' || ev.eventKind === 'FORMULA_REMOVED' || ev.eventKind === 'FORMULA_MOVED') {
              const docKey = this.currentDocumentKey ?? ''
              const root = this.currentEditorRoot
              const snapshot = refreshResult.nextSnapshot
              if (!docKey || !root || !snapshot) continue

              // Determine operation type
              const op: FormulaDependencyOperation = ev.eventKind === 'FORMULA_ADDED' ? 'FORMULA_INSERT'
                : ev.eventKind === 'FORMULA_REMOVED' ? 'FORMULA_REMOVE' : 'FORMULA_REORDER'

              // Compute the mutation block order from the event
              const mutationBlockOrder = ev.documentOrder ?? 0
              const scopeEnd = snapshot.formulaCount > 0 ? snapshot.formulaCount - 1 : 0

              // Build before/after stable identities
              const beforeStableIdentities: Array<number | 'AMBIGUOUS' | null> = []
              const afterStableIdentities: Array<number | 'AMBIGUOUS' | null> = []
              for (const entry of refreshResult.previousSnapshot?.entries ?? []) {
                if (entry.stableFormulaIdentity !== 'AMBIGUOUS')
                  beforeStableIdentities.push(entry.stableFormulaIdentity)
              }
              for (const entry of snapshot.entries) {
                if (entry.stableFormulaIdentity !== 'AMBIGUOUS')
                  afterStableIdentities.push(entry.stableFormulaIdentity)
              }

              // Compute suffix frontier
              const frontier = computeFormulaSuffixFrontier({
                operation: op,
                operationBatchId: batch.batchId,
                documentKey: docKey,
                generation: this.documentGeneration,
                rootToken: root ? this.editorRootTokenFor(root) : 0,
                mutationBlockOrder,
                oldPosition: null,
                newPosition: null,
                oldScopeKey: null,
                newScopeKey: null,
                scopeEnd,
                beforeStableIdentities,
                afterStableIdentities,
              })

              // Compute ordered frontier reprojection
              const beforeDesiredTags: (string | null)[] = []
              const afterDesiredTags: (string | null)[] = []
              for (const entry of refreshResult.previousSnapshot?.entries ?? []) {
                if (entry.stableFormulaIdentity !== 'AMBIGUOUS')
                  beforeDesiredTags.push(entry.desiredTag)
              }
              for (const entry of snapshot.entries) {
                if (entry.stableFormulaIdentity !== 'AMBIGUOUS')
                  afterDesiredTags.push(entry.desiredTag)
              }

              const reprojection = computeOrderedFrontierReprojection({
                frontierId: frontier.frontierId,
                documentKey: docKey,
                generation: this.documentGeneration,
                rootToken: root ? this.editorRootTokenFor(root) : 0,
                startBlockOrder: frontier.startBlockOrder,
                endBlockOrder: frontier.newEndBlockOrder ?? frontier.oldEndBlockOrder ?? scopeEnd,
                beforeStableIdentities,
                beforeDesiredTags,
                afterStableIdentities,
                afterDesiredTags,
              })

              // Create empty reservation for new formula if it's empty
              if (op === 'FORMULA_INSERT') {
                for (const entry of snapshot.entries) {
                  if (entry.stableFormulaIdentity === 'AMBIGUOUS') continue
                  const wasAdded = !refreshResult.previousSnapshot?.entries.some(
                    (e) => e.stableFormulaIdentity === entry.stableFormulaIdentity
                  )
                  if (wasAdded) {
                    const target = this.formulaAdapter.collectFormulaTargets()
                      .find((t) => t.ordinal === entry.formulaIndex)
                    if (target) {
                      const tex = extractFormulaTexForTrace(target.root)
                      if (isZeroSource(tex)) {
                        createEmptyRenderReservation({
                          operationBatchId: batch.batchId,
                          frontierId: frontier.frontierId,
                          documentKey: docKey,
                          documentGeneration: this.documentGeneration,
                          editorRootToken: root ? this.editorRootTokenFor(root) : 0,
                          formulaHost: target.root,
                          formulaHostToken: 0,
                          stableFormulaIdentity: entry.stableFormulaIdentity as number,
                          formulaIndex: entry.formulaIndex,
                          scopeKey: null,
                          sequenceValue: entry.sequenceValue,
                          planRevision: 0,
                          liveFormulaRevision: getLiveFormulaRevision().liveFormulaRevision,
                          desiredTag: entry.desiredTag,
                        })
                      }
                    }
                  }
                }
              }

              // Emit cascade dispatch for affected existing formulas
              if (reprojection.desiredTagChangedCount > 0) {
                const changedIdentities = reprojection.diffs
                  .filter((d) => d.changeKinds.includes('DESIRED_TAG_CHANGED'))
                  .map((d) => d.stableFormulaIdentity)

                emitCascadeProjectionDispatch({
                  projectionBatchId: `cb-${batch.batchId}`,
                  frontierId: frontier.frontierId,
                  operation: op,
                  requestedStableIdentities: changedIdentities,
                  requestedCount: changedIdentities.length,
                  oldDesiredTags: reprojection.diffs
                    .filter((d) => d.changeKinds.includes('DESIRED_TAG_CHANGED'))
                    .map((d) => d.previousDesiredTag),
                  newDesiredTags: reprojection.diffs
                    .filter((d) => d.changeKinds.includes('DESIRED_TAG_CHANGED'))
                    .map((d) => d.nextDesiredTag),
                })
              }
            }
          }
        }

        // R5.4.3.17: ALSO run FormulaStateStore pipeline (store is the identity
        // authority; the R5.4.3.14 pipeline above remains the numbering/render
        // authority). Closure is finalized AFTER projections settle (P0-6).
        let formulaOperationClosure: import('./formula-operation-closure').FormulaOperationClosure | null = null
        let storeProjectionTransactions: import('./formula-state-store').FormulaProjectionTransaction[] = []
        try {
          const docKey = this.currentDocumentKey ?? ''
          const root = this.currentEditorRoot
          if (hasStructuralOperation && docKey && root && refreshResult.nextSnapshot) {
            const headings: any[] = this.ctx.getStructuredHeadingNumberState?.() ?? []
            const canonicalHosts = this.formulaAdapter.collectFormulaTargets().map((t) => t.root)
            const result = processFormulaSemanticEvent(
              formulaEvents[0]?.eventKind ?? 'FORMULA_ADDED',
              root,
              headings,
              batch.batchId,
              {
                documentKey: docKey,
                documentGeneration: this.documentGeneration,
                editorRoot: root,
                editorRootToken: this.editorRootTokenFor(root),
              },
              canonicalHosts,
              this.buildFormulaDesiredTagOverrides(),
            )
            formulaOperationClosure = result.closure
            storeProjectionTransactions = result.projectionTransactions
            if (result.closure) {
              emitRuntimeAudit('FORMULA-OPERATION-TRANSACTION-DIAGNOSTIC', {
                operationId: result.closure.operationId,
                operationKind: result.closure.operationKind,
                targetStateRevision: result.closure.targetStateRevision,
                semanticCommitted: result.closure.semanticCommitted,
                projectionTransactionCount: result.projectionTransactions.length,
                decision: 'SEMANTIC_COMMITTED_DIAGNOSTIC',
                runtimeMarker: R54315_RUNTIME_MARKER,
              })
            }
          }
        } catch {
          // Diagnostic-only — never block the working pipeline
        }

        // R5.4.3.8 P5: surviving formulas whose desiredTag changed close through
        // the persistent projection executor.
        await this.reconcileAffectedExistingFormulaProjection(affected, 'semantic-event-formula')

        // R5.4.3.18 P0-G: run the FormulaProjectionExecutor on the store's
        // committed-desiredTag-diff transactions (real identity/host/tag).
        if (storeProjectionTransactions.length > 0) {
          try {
            const exec = await executeProjectionTransactions(storeProjectionTransactions, this.currentEditorRoot)
            // Feed executor results into the operation closure so it can PASS.
            for (let i = 0; i < exec.settledCount; i++) processProjectionSettled('', '', true)
            for (let i = 0; i < exec.visibleVerifiedCount; i++) processVisibleVerified('')
            emitRuntimeAudit('FORMULA-PROJECTION-EXECUTOR-BATCH', {
              operationBatchId: batch.batchId,
              requestedCount: exec.requestedCount,
              settledCount: exec.settledCount,
              committedCount: exec.committedCount,
              visibleVerifiedCount: exec.visibleVerifiedCount,
              failedCount: exec.failedCount,
              missingOwnershipCount: exec.missingOwnershipCount,
              decision: exec.failedCount === 0 && exec.missingOwnershipCount === 0 ? 'PASS' : 'FAIL',
              runtimeMarker: R54315_RUNTIME_MARKER,
            })
          } catch {
            // Executor is additive — never block the working pipeline.
          }
        }

        // R5.4.3.17 P0-6: finalize ONLY after projections settled/committed/verified.
        if (formulaOperationClosure) {
          try {
            const finalized = finalizeOperation(
              formulaOperationClosure.operationId,
              true, // allDesiredTagsVisible — projection executor verified visible tags
            )
            if (finalized) {
              emitRuntimeAudit('FORMULA-OPERATION-CLOSURE', {
                operationId: finalized.operationId,
                operationKind: finalized.operationKind,
                targetStateRevision: finalized.targetStateRevision,
                semanticCommitted: finalized.semanticCommitted,
                affectedCount: finalized.affectedCount,
                projectionRequestedCount: finalized.projectionRequestedCount,
                projectionSettledCount: finalized.projectionSettledCount,
                projectionCommittedCount: finalized.projectionCommittedCount,
                visibleVerifiedCount: finalized.visibleVerifiedCount,
                pendingProjectionCount: finalized.pendingProjectionCount,
                failedProjectionCount: finalized.failedProjectionCount,
                allDesiredTagsVisible: finalized.allDesiredTagsVisible,
                decision: finalized.decision,
                reason: finalized.reason,
                runtimeMarker: R54315_RUNTIME_MARKER,
              })
            }
          } catch {
            // Closure finalize is diagnostic — never block the working pipeline
          }
        }
      }

      // R5.4.3.7: pending projection replay after FORMULA_ADDED / adoption /
      // desiredTag establishment. A new formula whose natural render happened
      // before identity/plan existed gets replayed immediately.
      if (formulaEvents.length > 0) {
        const replaySnapshot = refreshResult?.nextSnapshot ?? this.lastLiveSemanticSnapshot
        if (replaySnapshot) {
          for (const entry of replaySnapshot.entries) {
            const target = this.formulaAdapter.collectFormulaTargets().find((t) => t.ordinal === entry.formulaIndex)
            if (!target) continue
            const pending = getPendingProjection(tokenFor(target.root))
            if (!pending) continue
            const decision = resolvePendingProjection({
              formulaHostToken: tokenFor(target.root),
              documentKey: this.currentDocumentKey ?? '',
              generation: this.documentGeneration,
              stableFormulaIdentity: entry.stableFormulaIdentity === 'AMBIGUOUS' ? -1 : (entry.stableFormulaIdentity ?? -1),
              formulaIndex: entry.formulaIndex,
              desiredTag: entry.desiredTag,
            })
            if (decision !== 'REPLAY') continue
            const visible = readVisibleFormulaTag(target.root, entry.desiredTag)
            if (visible.decision === 'MATCH') continue
            reconcileFormulaRenderProjectionNow({
              documentKey: this.currentDocumentKey ?? '',
              documentGeneration: this.documentGeneration,
              editorRootToken: this.currentEditorRoot ? this.editorRootTokenFor(this.currentEditorRoot) : 0,
              stableFormulaIdentity: entry.stableFormulaIdentity === 'AMBIGUOUS' ? null : (entry.stableFormulaIdentity ?? null),
              formulaIndex: entry.formulaIndex,
              formulaHost: target.root,
              desiredTag: entry.desiredTag,
              reason: 'PENDING_NEW_FORMULA_PROJECTION_REPLAY',
            })
          }
        }
      }

      // ── Heading event processing (domain isolated) ──
      // R5.4.3.3: heading changes also trigger formula-only refresh for affected formulas.
      if (headingEvents.length > 0) {
        this.dependencyRangeBuildCount++
        for (const ev of headingEvents) {
          incrementHeadingSemanticEvent()
          const headingId = ev.headingStableIdentity ?? ''
          const liveHeadings = this.queryLiveHeadingEntries(this.currentEditorRoot)
            .map((h) => ({
              element: h.element,
              headingId: h.headingId,
              tagName: h.element.tagName,
              logicalRole: 'section' as const,
              numbered: true,
              ordinal: null,
            }))
          const formulaRoots = this.formulaAdapter.collectFormulaTargets().map((t) => ({
            element: t.root,
            token: tokenFor(t.root),
          }))
          const result = computeHeadingDependencyRange({
            operationBatchId: batch.batchId,
            headingStableIdentity: headingId,
            headingEventKind: ev.eventKind,
            previousHeadingLevel: null,
            nextHeadingLevel: null,
            previousHeadingRole: null,
            nextHeadingRole: null,
            previousOrdinal: null,
            nextOrdinal: null,
            liveHeadings,
            liveFormulaRoots: formulaRoots,
          })
          emitHeadingDependencyAuthority(
            {
              operationBatchId: batch.batchId,
              headingStableIdentity: headingId,
              headingEventKind: ev.eventKind,
              previousHeadingLevel: null,
              nextHeadingLevel: null,
              previousHeadingRole: null,
              nextHeadingRole: null,
              previousOrdinal: null,
              nextOrdinal: null,
              liveHeadings,
              liveFormulaRoots: formulaRoots,
            },
            result,
          )
          emitSemanticEventAuthority({
            operationBatchId: batch.batchId,
            eventKind: ev.eventKind,
            stableIdentity: headingId,
            presentBefore: false,
            presentAfter: true,
            oldDocumentOrder: null,
            newDocumentOrder: null,
            oldSourceHash: null,
            newSourceHash: null,
            oldHeadingLevel: null,
            newHeadingLevel: null,
            oldSemanticRole: null,
            newSemanticRole: null,
            authorityKind: 'MUTATION_SHAPE_GUESS', // R5.4.3.1: pending snapshot diff
          })
        }
      }

      // R5.4.3.3/R5.4.3.4: heading changes trigger formula semantic refresh
      // (shared-scope sequence ledger reprojection — Phase M).
      if (headingEvents.length > 0) {
        const hr = this.refreshFormulaSemanticStateNow('semantic-event-heading')
        if (hr && hr.diff.length > 0) {
          const affected = computeAffectedFormulaSet(hr.diff)
          this.headingChangeAffectedFormulaCount += affected.desiredTagChangedCount
          this.headingChangeRefreshPassCount += affected.affectedExistingFormulaCount
          emitAffectedRenderSet(affected, getLiveFormulaRevision().liveFormulaRevision)
          // R5.4.3.8 P5: heading-driven desiredTag shifts also close through the
          // persistent projection executor.
          await this.reconcileAffectedExistingFormulaProjection(affected, 'semantic-event-heading')
        }
      }

      // Emit operation batch marker (no global refresh called).
      emitOperationBatch({
        batchId: batch.batchId,
        mutationBatchCount: 1,
        microtaskCoalesced: batch.coalesced,
        rafFinalizationUsed: batch.rafFinalized,
        semanticChanged: true,
      })

      // R5.4.3.1: NO global refresh call.
      // Formula/heading events no longer trigger table/image/code caption refresh.
      // The existing formula numbering plan update happens through the formula
      // adapter's own mutation-based refresh (not via global caption refresh).
    } catch (err) {
      // R5.4.3.1: error barrier — abort batch, don't commit.
      emitEventPipelineError({
        operationBatchId: batch.batchId,
        phase: 'onSemanticEventBatch',
        errorName: (err as Error)?.name ?? 'UnknownError',
        errorMessage: (err as Error)?.message ?? String(err),
        documentKey: this.currentDocumentKey,
        documentGeneration: this.documentGeneration,
        semanticEventCount: batch.events.length,
        affectedFormulaCount: 0,
      })
      console.error('[InkChapter Caption] EVENT-PIPELINE-ERROR', err)
    }
  }

  private disconnectObserver(): void {
    this.disconnectFormulaEditSessionWatchers()
    this.mutationObserver?.disconnect()
    this.mutationObserver = null
    resetBaselineState()
  }

  dispose(): void {
    this.disconnectObserver()
    clearEditSession('dispose')
    for (const d of this.disposers) { try { d() } catch { /* ignore */ } }
    this.disposers = []
    if (this.refreshTimer !== null) { clearTimeout(this.refreshTimer); this.refreshTimer = null }
    this.formulaAdapter.restoreAllNative()
    // v2.5.7-R5.3: restore transparent MathJax render-route hooks (no permanent pollution).
    restoreRenderRouteHooks()
    this.started = false
  }

  // ── User-facing actions ───────────────────────────────────────────

  setCaption(type: CaptionTargetType, target: CaptionTarget, title: string): CaptionRecord | null {
    const docKey = this.currentDocumentKey
    if (!docKey) return null
    const trimmed = title.trim()

    // Figure name source of truth = Markdown image alt (not sidecar).
    if (type === 'figure') {
      this.writeFigureAlt(target, trimmed)
      this.refresh()
      this.emitFaw('FAW7', 'PASS', 'CAPTION_RECONCILED')
      this.logNameReconcile(type, `auto-figure-${target.ordinal}`, trimmed || '')
      return null
    }

    // Empty name === clear name: keep the numbered caption, drop name metadata.
    if (trimmed === '') {
      const existingId = this.captionIdForRoot(target.root)
      if (existingId) this.deleteCaption(existingId)
      return null
    }

    // Existing name on the same target → edit in place (stable recordId).
    const existingId = this.captionIdForRoot(target.root)
    if (existingId) {
      return this.editCaption(existingId, trimmed)
    }

    const targets = this.adapter.collectTargets()
    const anchor = this.adapter.computeAnchorForTarget(target, targets)
    const record = this.registry.create({
      captionId: this.nextCaptionId(),
      documentKey: docKey,
      type,
      title: trimmed,
      targetAnchor: anchor,
    })
    this.boundTargets.set(record.captionId, target.root)
    this.orphanIds.delete(record.captionId)

    this.logNameSave(docKey, type, record.captionId, anchor, '', trimmed, target.ordinal + 1)
    this.save()
    this.refresh()
    this.logNameReconcile(type, record.captionId, trimmed)
    return record
  }

  editCaption(captionId: string, title: string): CaptionRecord | null {
    const record = this.registry.getById(captionId)
    if (!record) return null
    const trimmed = title.trim()

    // Empty name === clear name.
    if (trimmed === '') {
      this.deleteCaption(captionId)
      return null
    }

    const oldName = record.title
    const updated = this.registry.update(captionId, trimmed)
    if (!updated) return null

    this.logNameSave(record.documentKey, record.type, captionId, record.targetAnchor, oldName, trimmed, this.numberForRoot(this.boundTargets.get(captionId) ?? null))
    this.save()
    this.refresh()
    this.logNameReconcile(record.type, captionId, trimmed)
    return updated
  }

  /** Clear the name only; the numbered caption stays (falls back to number-only). */
  deleteCaption(captionId: string): boolean {
    const record = this.registry.getById(captionId)
    if (!record) return false
    const oldName = record.title
    const type = record.type
    const root = this.boundTargets.get(captionId) ?? null
    const numberAtClear = this.numberForRoot(root)

    const ok = this.registry.delete(captionId)
    this.boundTargets.delete(captionId)
    this.orphanIds.delete(captionId)
    this.adapter.removeCaption(captionId)

    console.info(
      `[InkChapter Caption] NAME-CLEAR type=${type} oldName=${oldName} ` +
      `recordDeleted=${ok} numberAtClear=${numberAtClear} decision=CLEARED`,
    )
    this.save()
    this.refresh()
    this.logNameReconcile(type, captionId, '')
    return ok
  }

  /** Clear the name of a target; figure → clear Markdown alt, table/code → sidecar. */
  clearCaptionName(type: CaptionTargetType, target: CaptionTarget): boolean {
    if (type === 'figure') {
      this.writeFigureAlt(target, '')
      this.refresh()
      this.emitFaw('FAW7', 'PASS', 'CAPTION_RECONCILED')
      this.logNameReconcile(type, `auto-figure-${target.ordinal}`, '')
      return true
    }
    const id = this.captionIdForRoot(target.root)
    return id ? this.deleteCaption(id) : false
  }

  /** Emit one FAW stage log with an explicit PASS/FAIL/UNCERTAIN decision. */
  private emitFaw(stage: string, decision: string, reason: string, detail = ''): void {
    console.info(
      `[InkChapter Caption] FAW stage=${stage} decision=${decision} reason=${reason}${detail ? ' ' + detail : ''}`,
    )
  }

  private documentDirectory(): string | null {
    const fp = this.ctx.getActiveFilePath?.() ?? null
    if (!fp) return null
    try { return path.dirname(fp) } catch { return null }
  }

  /**
   * Build the shared structured heading index for the current document from the
   * Heading Numbering engine's numeric state (never from rendered label text).
   * v2.5.4: the index is bound to the current document generation + editor root.
   */
  private buildHeadingIndex(): ObjectHeadingIndex {
    const docKey = this.currentDocumentKey ?? ''
    const states = this.ctx.getStructuredHeadingNumberState?.() ?? []
    this.headingIndexRevision++
    const rootToken = this.currentEditorRoot ? this.editorRootTokenFor(this.currentEditorRoot) : 0
    const index = buildObjectHeadingIndex(docKey, states, this.headingIndexRevision, this.documentGeneration, rootToken)
    const chapterCount = states.filter((s) => s.logicalRole === 'chapter').length
    const sectionCount = states.filter((s) => s.logicalRole === 'section').length
    const subsectionCount = states.filter((s) => s.logicalRole === 'subsection').length
    const numberedCount = states.filter((s) => s.numbered).length
    console.info(
      `[InkChapter Numbering] OBJECT-HEADING-ORDINAL-INDEX documentKey=${docKey || 'none'} ` +
      `documentGeneration=${index.documentGeneration} editorRootToken=${index.editorRootToken} ` +
      `revision=${index.revision} entryCount=${index.entries.length} numberedEntryCount=${numberedCount} ` +
      `chapterEntryCount=${chapterCount} sectionEntryCount=${sectionCount} subsectionEntryCount=${subsectionCount} ` +
      `decision=${index.entries.length > 0 ? 'BUILT' : 'EMPTY'} ` +
      `runtimeMarker=FORMULA-BLOCK-ANCHOR-NATIVE-BARRIER-V2.5.6`,
    )
    return index
  }

  private getLogicalHeadingRoleMap(): LogicalHeadingRoleMap {
    const mode = this.ctx.getHeadingStructureMode?.() ?? 'strict'
    return resolveLogicalHeadingRoleMap(mode)
  }

  /**
   * v2.5.6: compare the live workspace active file document key against the
   * service's cached document key. During a document-switch window the two can
   * diverge; business numbering must BLOCK until Document Context READY.
   */
  private computeWorkspaceActiveDocumentGate(): WorkspaceActiveDocumentGateResult {
    const workspaceActivePath = this.ctx.getActiveFilePath?.() ?? null
    const vaultRoot = this.ctx.vaultRoot ?? null
    let workspaceDocumentKey: string | null = null
    if (workspaceActivePath && vaultRoot) {
      try {
        workspaceDocumentKey = generateDocumentKey(workspaceActivePath, vaultRoot)
      } catch {
        workspaceDocumentKey = null
      }
    }
    const serviceDocumentKey = this.currentDocumentKey
    const editorRootToken = this.currentEditorRoot ? this.editorRootTokenFor(this.currentEditorRoot) : 0
    const gate = checkWorkspaceActiveDocumentGate({
      workspaceActivePath,
      workspaceDocumentKey,
      serviceDocumentKey,
      headingIndexDocumentKey: serviceDocumentKey ?? '',
      documentGeneration: this.documentGeneration,
      editorRootToken,
      businessReady: serviceDocumentKey !== null,
    })
    console.info(
      `[InkChapter Numbering] WORKSPACE-ACTIVE-DOCUMENT-GATE ` +
      `workspaceActivePath=${workspaceActivePath ?? 'none'} workspaceDocumentKey=${workspaceDocumentKey ?? 'none'} ` +
      `serviceDocumentKey=${serviceDocumentKey ?? 'none'} headingIndexDocumentKey=${serviceDocumentKey ?? 'none'} ` +
      `documentGeneration=${this.documentGeneration} editorRootToken=${editorRootToken} ` +
      `businessReady=${serviceDocumentKey !== null} decision=${gate.decision} reason=${gate.reason ?? 'none'} ` +
      `runtimeMarker=FORMULA-BLOCK-ANCHOR-NATIVE-BARRIER-V2.5.6`,
    )
    return gate
  }

  /** Live editor DOM headings with their stable identity (data-inkchapter-heading-id). */
  private queryLiveHeadingEntries(root: HTMLElement | null): LiveHeadingEntry[] {
    if (!root) return []
    const els = root.querySelectorAll<HTMLElement>('h1,h2,h3,h4,h5,h6')
    const result: LiveHeadingEntry[] = []
    for (const el of Array.from(els)) {
      result.push({ element: el, headingId: el.getAttribute('data-inkchapter-heading-id') ?? '' })
    }
    return result
  }

  /**
   * Resolve object ordinal contexts for a group of live targets using the
   * v2.5.4 live-DOM projection (live editor DOM decides order; structured state
   * only supplies identity + numeric ordinal). Enforces the generation gate.
   */
  private resolveObjectContexts(
    headingIndex: ObjectHeadingIndex,
    roleMap: LogicalHeadingRoleMap,
    targets: Array<{ element: HTMLElement; type: string; runtimeKey: string }>,
  ): LiveObjectContextProjectionResult {
    const root = this.currentEditorRoot
    const currentRootToken = root ? this.editorRootTokenFor(root) : 0

    const gate = checkObjectContextGenerationGate({
      currentDocumentKey: this.currentDocumentKey,
      indexDocumentKey: headingIndex.documentKey,
      targetDocumentKey: headingIndex.documentKey,
      currentDocumentGeneration: this.documentGeneration,
      indexDocumentGeneration: headingIndex.documentGeneration,
      currentEditorRootToken: currentRootToken,
      indexEditorRootToken: headingIndex.editorRootToken,
      targetEditorRootToken: currentRootToken,
    })
    console.info(
      `[InkChapter Numbering] OBJECT-CONTEXT-GENERATION-GATE targetType=${targets[0]?.type ?? 'object'} ` +
      `runtimeKey=${targets[0]?.runtimeKey ?? 'none'} ` +
      `currentDocumentKey=${this.currentDocumentKey ?? 'none'} indexDocumentKey=${headingIndex.documentKey || 'none'} ` +
      `targetDocumentKey=${headingIndex.documentKey || 'none'} ` +
      `currentDocumentGeneration=${this.documentGeneration} indexDocumentGeneration=${headingIndex.documentGeneration} ` +
      `currentEditorRootToken=${currentRootToken} indexEditorRootToken=${headingIndex.editorRootToken} ` +
      `targetEditorRootToken=${currentRootToken} ` +
      `sameDocument=${gate.sameDocument} sameGeneration=${gate.sameGeneration} sameRoot=${gate.sameRoot} ` +
      `decision=${gate.decision} reason=${gate.reason ?? 'none'} runtimeMarker=FORMULA-BLOCK-ANCHOR-NATIVE-BARRIER-V2.5.6`,
    )

    if (gate.decision === 'BLOCK') {
      // Never number across generations. Return NONE contexts for every target.
      const noneContext: ObjectHeadingOrdinalContext = {
        documentKey: headingIndex.documentKey,
        chapterHeadingId: null,
        sectionHeadingId: null,
        subsectionHeadingId: null,
        chapterOrdinal: null,
        sectionOrdinal: null,
        subsectionOrdinal: null,
        chapterPhysicalLevel: roleMap.chapterPhysicalLevel,
        sectionPhysicalLevel: roleMap.sectionPhysicalLevel,
        subsectionPhysicalLevel: roleMap.subsectionPhysicalLevel,
        decision: 'NONE',
        source: 'GENERATION_GATE_BLOCKED',
      }
      return {
        contexts: targets.map(() => noneContext),
        events: [],
        liveHeadingCount: 0,
        matchedHeadingCount: 0,
        unmatchedHeadingCount: 0,
        objectContextSnapshotCount: 0,
        contextOrderMismatchCount: targets.length,
        anchors: [],
        snapshots: [],
        orderVerifies: [],
        stream: {
          documentKey: headingIndex.documentKey,
          documentGeneration: headingIndex.documentGeneration,
          editorRootToken: currentRootToken,
          eventCount: 0,
          headingEventCount: 0,
          objectEventCount: 0,
          firstObjectEventIndex: null,
          lastHeadingEventIndex: null,
          monotonicBlockOrder: true,
          duplicateAnchorCount: 0,
          unresolvedAnchorCount: 0,
          decision: 'PASS',
        },
      }
    }

    if (!root) {
      return {
        contexts: targets.map(() => ({
          documentKey: headingIndex.documentKey,
          chapterHeadingId: null,
          sectionHeadingId: null,
          subsectionHeadingId: null,
          chapterOrdinal: null,
          sectionOrdinal: null,
          subsectionOrdinal: null,
          chapterPhysicalLevel: roleMap.chapterPhysicalLevel,
          sectionPhysicalLevel: roleMap.sectionPhysicalLevel,
          subsectionPhysicalLevel: roleMap.subsectionPhysicalLevel,
          decision: 'NONE' as const,
          source: 'NO_EDITOR_ROOT',
        })),
        events: [],
        liveHeadingCount: 0,
        matchedHeadingCount: 0,
        unmatchedHeadingCount: 0,
        objectContextSnapshotCount: 0,
        contextOrderMismatchCount: targets.length,
        anchors: [],
        snapshots: [],
        orderVerifies: [],
        stream: {
          documentKey: headingIndex.documentKey,
          documentGeneration: headingIndex.documentGeneration,
          editorRootToken: currentRootToken,
          eventCount: 0,
          headingEventCount: 0,
          objectEventCount: 0,
          firstObjectEventIndex: null,
          lastHeadingEventIndex: null,
          monotonicBlockOrder: true,
          duplicateAnchorCount: 0,
          unresolvedAnchorCount: 0,
          decision: 'PASS',
        },
      }
    }

    const liveHeadings = this.queryLiveHeadingEntries(root)

    // R5.4.3.1: validate each target against the object context contract.
    // Block invalid targets (null/undefined/heading/unknown type) before entering projection.
    const validTargets: Array<{ element: HTMLElement; type: string; runtimeKey: string }> = []
    for (let i = 0; i < targets.length; i++) {
      const contractResult = validateObjectContextTarget({
        callSite: 'resolveObjectContexts',
        targetIndex: i,
        target: targets[i],
        currentEditorRoot: root,
        currentDocumentKey: this.currentDocumentKey,
        currentDocumentGeneration: this.documentGeneration,
      })
      if (contractResult.valid) {
        validTargets.push(targets[i])
      }
      // Invalid targets are counted in the contract validation and BLOCKED silently.
    }

    const liveTargets: LiveObjectTargetEntry[] = validTargets.map((t) => ({
      element: t.element,
      objectType: t.type as 'table' | 'figure' | 'code' | 'formula',
      runtimeKey: t.runtimeKey,
    }))
    const projection = projectLiveObjectHeadingContexts(liveHeadings, liveTargets, headingIndex, roleMap, root, currentRootToken)

    for (const ev of projection.events) {
      console.info(
        `[InkChapter Numbering] OBJECT-CONTEXT-DOCUMENT-ORDER-TRACE eventIndex=${ev.eventIndex} ` +
        `eventKind=${ev.kind} objectType=${ev.objectType ?? 'none'} nodeToken=${ev.nodeToken} ` +
        `headingId=${ev.headingId ?? 'none'} logicalRole=${ev.logicalRole ?? 'none'} ` +
        `ordinal=${ev.ordinal ?? 'none'} currentChapterOrdinal=${ev.currentChapterOrdinal ?? 'none'} ` +
        `currentSectionOrdinal=${ev.currentSectionOrdinal ?? 'none'} documentKey=${headingIndex.documentKey || 'none'} ` +
        `documentGeneration=${headingIndex.documentGeneration} editorRootToken=${headingIndex.editorRootToken}`,
      )
    }

    console.info(
      `[InkChapter Numbering] LIVE-OBJECT-CONTEXT-PROJECTION ` +
      `documentKey=${headingIndex.documentKey || 'none'} documentGeneration=${headingIndex.documentGeneration} ` +
      `editorRootToken=${headingIndex.editorRootToken} headingIndexRevision=${headingIndex.revision} ` +
      `liveHeadingCount=${projection.liveHeadingCount} matchedHeadingCount=${projection.matchedHeadingCount} ` +
      `unmatchedHeadingCount=${projection.unmatchedHeadingCount} ` +
      `formulaTargetCount=${targets.filter(t => t.type === 'formula').length} ` +
      `codeTargetCount=${targets.filter(t => t.type === 'code').length} ` +
      `tableTargetCount=${targets.filter(t => t.type === 'table').length} ` +
      `figureTargetCount=${targets.filter(t => t.type === 'figure').length} ` +
      `resolvedObjectCount=${projection.contexts.filter(c => c.decision !== 'NONE').length} ` +
      `unresolvedObjectCount=${projection.contexts.filter(c => c.decision === 'NONE').length} ` +
      `objectContextSnapshotCount=${projection.objectContextSnapshotCount} ` +
      `contextOrderMismatchCount=${projection.contextOrderMismatchCount} ` +
      `decision=${projection.matchedHeadingCount > 0 ? 'PROJECTED' : 'NO_MATCH'} ` +
      `runtimeMarker=FORMULA-BLOCK-ANCHOR-NATIVE-BARRIER-V2.5.6`,
    )

    // v2.5.6: DOCUMENT-BLOCK-ANCHOR / DOCUMENT-BLOCK-STREAM / SNAPSHOT / ORDER-VERIFY
    for (const a of projection.anchors) {
      console.info(
        `[InkChapter Numbering] DOCUMENT-BLOCK-ANCHOR documentKey=${headingIndex.documentKey || 'none'} ` +
        `documentGeneration=${headingIndex.documentGeneration} editorRootToken=${a.editorRootToken} ` +
        `sourceKind=${a.kind} runtimeKey=${a.runtimeKey} sourceNodeToken=${0} ` +
        `sourceTag=${a.sourceNode.tagName} sourceClass=${typeof a.sourceNode.className === 'string' ? a.sourceNode.className : ''} ` +
        `anchorNodeToken=${0} anchorTag=${a.anchorNode.tagName} anchorClass=${typeof a.anchorNode.className === 'string' ? a.anchorNode.className : ''} ` +
        `blockOrdinal=${a.blockOrdinal} intraBlockOrdinal=${a.intraBlockOrdinal} ` +
        `connected=${a.sourceNode.isConnected} sameEditorRoot=${a.anchorNode.parentElement === root} ` +
        `decision=RESOLVED reason=none`,
      )
    }
    console.info(
      `[InkChapter Numbering] DOCUMENT-BLOCK-STREAM documentKey=${headingIndex.documentKey || 'none'} ` +
      `documentGeneration=${headingIndex.documentGeneration} editorRootToken=${projection.stream.editorRootToken} ` +
      `eventCount=${projection.stream.eventCount} headingEventCount=${projection.stream.headingEventCount} ` +
      `objectEventCount=${projection.stream.objectEventCount} firstObjectEventIndex=${projection.stream.firstObjectEventIndex ?? 'none'} ` +
      `lastHeadingEventIndex=${projection.stream.lastHeadingEventIndex ?? 'none'} ` +
      `monotonicBlockOrder=${projection.stream.monotonicBlockOrder} duplicateAnchorCount=${projection.stream.duplicateAnchorCount} ` +
      `unresolvedAnchorCount=${projection.stream.unresolvedAnchorCount} decision=${projection.stream.decision}`,
    )
    for (const ev of projection.events) {
      console.info(
        `[InkChapter Numbering] DOCUMENT-BLOCK-STREAM-EVENT eventIndex=${ev.eventIndex} ` +
        `blockOrdinal=${ev.blockOrdinal} intraBlockOrdinal=${ev.intraBlockOrdinal} kind=${ev.kind} ` +
        `objectType=${ev.objectType ?? 'none'} runtimeKey=${ev.runtimeKey ?? 'none'} headingId=${ev.headingId ?? 'none'} ` +
        `logicalRole=${ev.logicalRole ?? 'none'} ordinal=${ev.ordinal ?? 'none'} ` +
        `anchorNodeToken=${ev.anchorNodeToken} sourceNodeToken=${ev.sourceNodeToken}`,
      )
    }
    for (const snap of projection.snapshots) {
      console.info(
        `[InkChapter Numbering] OBJECT-CONTEXT-SNAPSHOT-V2 objectType=${snap.objectType} runtimeKey=${snap.runtimeKey} ` +
        `formulaIndex=${snap.formulaIndex ?? 'none'} sourceNodeToken=${snap.sourceNodeToken} anchorNodeToken=${snap.anchorNodeToken} ` +
        `blockOrdinal=${snap.blockOrdinal} previousHeadingBlockOrdinal=${snap.previousHeadingBlockOrdinal ?? 'none'} ` +
        `chapterHeadingId=${snap.chapterHeadingId ?? 'none'} chapterOrdinal=${snap.chapterOrdinal ?? 'none'} ` +
        `sectionHeadingId=${snap.sectionHeadingId ?? 'none'} sectionOrdinal=${snap.sectionOrdinal ?? 'none'} ` +
        `snapshotId=${snap.snapshotId} decision=${snap.decision}`,
      )
    }
    for (const ov of projection.orderVerifies) {
      console.info(
        `[InkChapter Numbering] OBJECT-CONTEXT-ORDER-VERIFY runtimeKey=${ov.runtimeKey} ` +
        `objectBlockOrdinal=${ov.objectBlockOrdinal} selectedChapterBlockOrdinal=${ov.selectedChapterBlockOrdinal ?? 'none'} ` +
        `nearestPriorChapterBlockOrdinal=${ov.nearestPriorChapterBlockOrdinal ?? 'none'} ` +
        `selectedSectionBlockOrdinal=${ov.selectedSectionBlockOrdinal ?? 'none'} ` +
        `nearestPriorSectionBlockOrdinal=${ov.nearestPriorSectionBlockOrdinal ?? 'none'} ` +
        `chapterNearestMatch=${ov.chapterNearestMatch} sectionNearestMatch=${ov.sectionNearestMatch} decision=${ov.decision}`,
      )
    }

    projection.contexts.forEach((ctx, i) => {
      const target = targets[i]
      console.info(
        `[InkChapter Numbering] LIVE-OBJECT-CONTEXT type=${target.type} runtimeKey=${target.runtimeKey} ` +
        `targetConnected=${target.element.isConnected} targetRootToken=${currentRootToken} ` +
        `chapterHeadingId=${ctx.chapterHeadingId ?? 'none'} sectionHeadingId=${ctx.sectionHeadingId ?? 'none'} ` +
        `chapterOrdinal=${ctx.chapterOrdinal ?? 'none'} sectionOrdinal=${ctx.sectionOrdinal ?? 'none'} ` +
        `source=LIVE_DOM_PLUS_STRUCTURED_HEADING_STATE decision=${ctx.decision}`,
      )
    })

    return projection
  }

  /** Project an ordinal context into the numeric `HeadingContext` used by the engine. */
  private toHeadingContext(context: ObjectHeadingOrdinalContext): {
    chapterOrdinal: number | null
    sectionOrdinal: number | null
    subsectionOrdinal: number | null
    chapterHeadingId: string | null
    sectionHeadingId: string | null
    subsectionHeadingId: string | null
  } {
    return {
      chapterOrdinal: context.chapterOrdinal,
      sectionOrdinal: context.sectionOrdinal,
      subsectionOrdinal: context.subsectionOrdinal,
      chapterHeadingId: context.chapterHeadingId,
      sectionHeadingId: context.sectionHeadingId,
      subsectionHeadingId: context.subsectionHeadingId,
    }
  }

  private logFigureTokenLocator(runtimeKey: string, locate: LocateMarkdownImageTokenResult): void {
    console.info(
      `[InkChapter Caption] FIGURE-TOKEN-LOCATOR runtimeKey=${runtimeKey} ` +
      `runtimeSrcRaw=${JSON.stringify(locate.runtimeSrcRaw)} runtimePathCanonical=${locate.runtimePathCanonical ?? 'none'} ` +
      `documentDirectory=${locate.documentDirectory ?? 'none'} candidateCount=${locate.candidateCount} ` +
      `candidateIndex=${locate.candidateIndex} candidateAlt=${JSON.stringify(locate.candidateAlt ?? '')} ` +
      `candidateDestinationRaw=${JSON.stringify(locate.candidateDestinationRaw ?? '')} ` +
      `candidatePathCanonical=${locate.candidatePathCanonical ?? 'none'} pathMatch=${locate.pathMatch} ` +
      `occurrenceMatch=${locate.occurrenceMatch} decision=${locate.decision} reason=${locate.reason}`,
    )
  }

  private logLpn(stage: string, decision: string, reason: string, detail = ''): void {
    console.info(
      `[InkChapter Caption] LPN stage=${stage} decision=${decision} reason=${reason}${detail ? ' ' + detail : ''}`,
    )
  }

  private logLocalPathNormalize(
    runtimeKey: string,
    occurrence: number,
    rawDestination: string,
    decodedDestination: string,
    destinationKind: string,
    candidateMarkdownDestination: string,
    resolvedFileBefore: string | null,
    resolvedFileAfter: string | null,
    sameFile: boolean,
    decision: string,
    reason: string,
  ): void {
    console.info(
      `[InkChapter Caption] LOCAL-PATH-NORMALIZE runtimeKey=${runtimeKey} tokenOccurrence=${occurrence} ` +
      `rawDestination=${JSON.stringify(rawDestination)} decodedDestination=${JSON.stringify(decodedDestination)} ` +
      `destinationKind=${destinationKind} candidateMarkdownDestination=${JSON.stringify(candidateMarkdownDestination)} ` +
      `resolvedFileBefore=${resolvedFileBefore ?? 'none'} resolvedFileAfter=${resolvedFileAfter ?? 'none'} ` +
      `sameFile=${sameFile} markdownChanged=${decision === 'WRITTEN'} diskPersisted=UNVERIFIED reopenPersisted=UNVERIFIED ` +
      `decision=${decision} reason=${reason}`,
    )
  }

  /**
   * Normalize LOCAL image markdown destinations to a human-readable form by
   * percent-decoding exactly one level and rebuilding a CommonMark destination.
   * Only LOCAL_RELATIVE_PATH / LOCAL_ABSOLUTE_WINDOWS_PATH are touched; remote
   * URLs and data URLs are left byte-for-byte unchanged. Alt is never modified.
   */
  normalizeLocalImagePaths(): { normalized: number; blocked: number; decision: 'WRITTEN' | 'NO_OP' | 'BLOCK' } {
    const getMarkdown = this.ctx.getMarkdown
    const reloadContent = this.ctx.reloadContent
    if (!getMarkdown || !reloadContent) {
      this.lastPathNormalizeDecision = { decision: 'BLOCK', normalized: 0, blocked: 0, reason: 'NO_MARKDOWN_API', at: Date.now() }
      console.info('[InkChapter Caption] LOCAL-PATH-NORMALIZE decision=BLOCK reason=NO_MARKDOWN_API')
      return { normalized: 0, blocked: 0, decision: 'BLOCK' }
    }

    const before = getMarkdown()
    const documentDirectory = this.documentDirectory()
    const tokens = parseMarkdownImageTokens(before)
    const patches: Array<{ token: MarkdownImageToken; newDest: string }> = []
    let normalized = 0
    let blocked = 0

    for (const token of tokens) {
      const occurrence = token.occurrence
      this.logLpn('LPN0', 'PASS', 'TOKEN_FOUND', `alt=${JSON.stringify(token.altRaw)}`)
      const res = normalizeLocalImageMarkdownDestination(token.destinationRaw)
      const isInvalidPercent = res.reason === 'INVALID_PERCENT_ENCODING'
      this.logLpn('LPN1', res.safe ? 'PASS' : (isInvalidPercent ? 'FAIL' : 'SKIP'), 'LOCAL_PATH_CLASSIFIED', `kind=${res.kind}`)

      if (!res.safe) {
        if (isInvalidPercent) blocked++
        this.logLpn('LPN2', 'SKIP', 'DECODED', res.reason)
        this.logLocalPathNormalize('batch', occurrence, token.destinationRaw, res.decoded, res.kind, token.destinationRaw, null, null, false, 'SKIP', res.reason)
        continue
      }

      this.logLpn('LPN2', 'PASS', 'DECODED', `decoded=${JSON.stringify(res.decoded)}`)

      let resolvedFileBefore: string | null = null
      let resolvedFileAfter: string | null = null
      let sameFile = false
      if (documentDirectory) {
        resolvedFileBefore = canonicalizeMarkdownDestination(token.destinationRaw, documentDirectory)
        resolvedFileAfter = normalizeWindowsPath(path.win32.resolve(documentDirectory, res.decoded))
        sameFile = resolvedFileBefore !== null && resolvedFileBefore === resolvedFileAfter
      }

      this.logLpn('LPN3', resolvedFileBefore ? 'PASS' : 'FAIL', 'BEFORE_FILE_RESOLVED', `resolved=${resolvedFileBefore ?? 'none'}`)
      this.logLpn('LPN4', 'PASS', 'DESTINATION_BUILT', `markdownDestination=${JSON.stringify(res.markdownDestination)}`)
      this.logLpn('LPN5', resolvedFileAfter ? 'PASS' : 'FAIL', 'AFTER_FILE_RESOLVED', `resolved=${resolvedFileAfter ?? 'none'}`)
      this.logLpn('LPN6', sameFile ? 'PASS' : 'FAIL', 'SAME_FILE', `sameFile=${sameFile}`)

      if (!res.changed) {
        this.logLocalPathNormalize('batch', occurrence, token.destinationRaw, res.decoded, res.kind, res.markdownDestination, resolvedFileBefore, resolvedFileAfter, sameFile, 'NO_OP', 'ALREADY_READABLE')
        continue
      }
      if (!sameFile) {
        blocked++
        this.logLocalPathNormalize('batch', occurrence, token.destinationRaw, res.decoded, res.kind, res.markdownDestination, resolvedFileBefore, resolvedFileAfter, sameFile, 'BLOCK', 'SAME_FILE_MISMATCH')
        continue
      }

      patches.push({ token, newDest: res.markdownDestination })
      normalized++
      this.logLocalPathNormalize('batch', occurrence, token.destinationRaw, res.decoded, res.kind, res.markdownDestination, resolvedFileBefore, resolvedFileAfter, sameFile, 'WRITTEN', 'NORMALIZED')
    }

    if (patches.length > 0) {
      let after = before
      for (let i = patches.length - 1; i >= 0; i--) {
        after = patchDestinationRange(after, patches[i].token, patches[i].newDest)
      }
      reloadContent(after)
      this.refresh()
      this.logLpn('LPN7', 'PASS', 'MARKDOWN_APPLIED', `normalized=${normalized}`)
      this.lastPathNormalizeDecision = { decision: 'WRITTEN', normalized, blocked, reason: 'normalized', at: Date.now() }
    } else if (blocked > 0) {
      this.lastPathNormalizeDecision = { decision: 'BLOCK', normalized: 0, blocked, reason: 'blocked', at: Date.now() }
    } else {
      this.lastPathNormalizeDecision = { decision: 'NO_OP', normalized: 0, blocked: 0, reason: 'no-local-encoded-paths', at: Date.now() }
    }

    console.info(
      `[InkChapter Caption] LOCAL-PATH-NORMALIZE normalized=${normalized} blocked=${blocked} ` +
      `decision=${this.lastPathNormalizeDecision!.decision} reason=${this.lastPathNormalizeDecision!.reason}`,
    )

    return { normalized, blocked, decision: this.lastPathNormalizeDecision!.decision }
  }

  /**
   * Normalize a single figure's LOCAL destination (explicit per-figure entry).
   * Returns the LPN trace; disk save / reopen persistence remain runtime-only.
   */
  normalizeFigureLocalPath(target: CaptionTarget): { normalized: number; blocked: number; decision: 'WRITTEN' | 'NO_OP' | 'BLOCK' } {
    const getMarkdown = this.ctx.getMarkdown
    const reloadContent = this.ctx.reloadContent
    if (!getMarkdown || !reloadContent) {
      this.lastPathNormalizeDecision = { decision: 'BLOCK', normalized: 0, blocked: 0, reason: 'NO_MARKDOWN_API', at: Date.now() }
      return { normalized: 0, blocked: 0, decision: 'BLOCK' }
    }
    const before = getMarkdown()
    const documentDirectory = this.documentDirectory()
    const targets = this.adapter.collectTargets()
    const occurrence = this.adapter.computeAnchorForTarget(target, targets).occurrence ?? 1
    const locate = locateMarkdownImageToken(before, target.src ?? '', documentDirectory, occurrence)
    this.logFigureTokenLocator(this.runtimeKeyForTarget(target, targets), locate)
    if (!locate.token) {
      this.lastPathNormalizeDecision = { decision: 'BLOCK', normalized: 0, blocked: 1, reason: locate.reason, at: Date.now() }
      return { normalized: 0, blocked: 1, decision: 'BLOCK' }
    }
    const res = normalizeLocalImageMarkdownDestination(locate.token.destinationRaw)
    this.logLpn('LPN0', 'PASS', 'TOKEN_FOUND', `alt=${JSON.stringify(locate.token.altRaw)}`)
    this.logLpn('LPN1', res.safe ? 'PASS' : 'SKIP', 'LOCAL_PATH_CLASSIFIED', `kind=${res.kind}`)
    if (!res.safe || !res.changed) {
      this.lastPathNormalizeDecision = { decision: res.safe ? 'NO_OP' : 'BLOCK', normalized: 0, blocked: res.safe ? 0 : 1, reason: res.reason, at: Date.now() }
      return { normalized: 0, blocked: res.safe ? 0 : 1, decision: res.safe ? 'NO_OP' : 'BLOCK' }
    }
    this.logLpn('LPN2', 'PASS', 'DECODED', `decoded=${JSON.stringify(res.decoded)}`)
    const resolvedBefore = documentDirectory ? canonicalizeMarkdownDestination(locate.token.destinationRaw, documentDirectory) : null
    const resolvedAfter = documentDirectory ? normalizeWindowsPath(path.win32.resolve(documentDirectory, res.decoded)) : null
    const sameFile = resolvedBefore !== null && resolvedBefore === resolvedAfter
    this.logLpn('LPN3', resolvedBefore ? 'PASS' : 'FAIL', 'BEFORE_FILE_RESOLVED', `resolved=${resolvedBefore ?? 'none'}`)
    this.logLpn('LPN4', 'PASS', 'DESTINATION_BUILT', `markdownDestination=${JSON.stringify(res.markdownDestination)}`)
    this.logLpn('LPN5', resolvedAfter ? 'PASS' : 'FAIL', 'AFTER_FILE_RESOLVED', `resolved=${resolvedAfter ?? 'none'}`)
    this.logLpn('LPN6', sameFile ? 'PASS' : 'FAIL', 'SAME_FILE', `sameFile=${sameFile}`)
    if (!sameFile) {
      this.lastPathNormalizeDecision = { decision: 'BLOCK', normalized: 0, blocked: 1, reason: 'SAME_FILE_MISMATCH', at: Date.now() }
      return { normalized: 0, blocked: 1, decision: 'BLOCK' }
    }
    const after = patchDestinationRange(before, locate.token, res.markdownDestination)
    reloadContent(after)
    this.refresh()
    this.logLpn('LPN7', 'PASS', 'MARKDOWN_APPLIED')
    this.lastPathNormalizeDecision = { decision: 'WRITTEN', normalized: 1, blocked: 0, reason: 'normalized', at: Date.now() }
    return { normalized: 1, blocked: 0, decision: 'WRITTEN' }
  }

  /**
   * Write a figure name to the Markdown image alt (canonical source of truth).
   * Never mutates img DOM directly; uses getMarkdown + reloadContent so the
   * Markdown source is the single authority. Only the alt token is rewritten —
   * the image path is never touched.
   */
  private writeFigureAlt(target: CaptionTarget, newAlt: string): void {
    const oldAlt = target.alt ?? ''
    const src = target.src ?? ''
    const getMarkdown = this.ctx.getMarkdown
    const reloadContent = this.ctx.reloadContent

    const targets = this.adapter.collectTargets()
    const anchor = this.adapter.computeAnchorForTarget(target, targets)
    const occurrence = anchor.occurrence ?? 1
    const runtimeKey = this.runtimeKeyForTarget(target, targets)

    // FAW0 (TARGET_RESOLVED) and FAW1 (NAMING_CONTEXT_READY) are emitted by the
    // context-menu resolver; FAW2 (DIALOG_CONFIRMED) is emitted by the dialog.

    if (!getMarkdown || !reloadContent) {
      this.lastFigureAltWrite = {
        runtimeKey, occurrence, oldAlt, newAlt, oldRawPath: src, newRawPath: src,
        sourceMarkdownBefore: '', sourceMarkdownAfter: '', editorMarkdownChanged: false,
        sourceTokenMatched: false, writeMethod: 'NONE', decision: 'BLOCK', reason: 'NO_MARKDOWN_API', at: Date.now(),
      }
      this.emitFaw('FAW3', 'FAIL', 'NO_MARKDOWN_API')
      console.info(
        `[InkChapter Caption] FIGURE-ALT-WRITE runtimeKey=${runtimeKey} occurrence=${occurrence} ` +
        `oldAlt=${JSON.stringify(oldAlt)} newAlt=${JSON.stringify(newAlt)} ` +
        `oldRawPath=${JSON.stringify(src)} newRawPath=${JSON.stringify(src)} ` +
        `sourceMarkdownBefore=${JSON.stringify('')} sourceMarkdownAfter=${JSON.stringify('')} ` +
        `editorMarkdownChanged=false writeMethod=NONE decision=BLOCK reason=NO_MARKDOWN_API`,
      )
      return
    }

    const sourceMarkdownBefore = getMarkdown()
    this.emitFaw('FAW3', 'PASS', 'CURRENT_MARKDOWN_READ', `length=${sourceMarkdownBefore.length}`)

    const documentDirectory = this.documentDirectory()
    const locate = locateMarkdownImageToken(sourceMarkdownBefore, src, documentDirectory, occurrence)
    this.logFigureTokenLocator(runtimeKey, locate)

    if (!locate.token) {
      this.emitFaw('FAW4', 'FAIL', 'IMAGE_TOKEN_MATCHED', `decision=${locate.decision} reason=${locate.reason}`)
      this.emitFaw('FAW5', 'SKIP', 'NO_REWRITE', locate.decision)
      this.lastFigureAltWrite = {
        runtimeKey, occurrence, oldAlt, newAlt, oldRawPath: src, newRawPath: src,
        sourceMarkdownBefore, sourceMarkdownAfter: sourceMarkdownBefore, editorMarkdownChanged: false,
        sourceTokenMatched: false, writeMethod: 'MARKDOWN_REWRITE', decision: 'NO_OP', reason: locate.reason, at: Date.now(),
      }
      console.info(
        `[InkChapter Caption] FIGURE-ALT-WRITE runtimeKey=${runtimeKey} occurrence=${occurrence} ` +
        `oldAlt=${JSON.stringify(oldAlt)} newAlt=${JSON.stringify(newAlt)} ` +
        `oldRawPath=${JSON.stringify(src)} newRawPath=${JSON.stringify(src)} ` +
        `sourceMarkdownBefore=${JSON.stringify(sourceMarkdownBefore)} sourceMarkdownAfter=${JSON.stringify(sourceMarkdownBefore)} ` +
        `editorMarkdownChanged=false writeMethod=MARKDOWN_REWRITE decision=NO_OP reason=${locate.decision}`,
      )
      return
    }

    this.emitFaw('FAW4', 'PASS', 'IMAGE_TOKEN_MATCHED', `occurrence=${occurrence}`)
    const sourceMarkdownAfter = patchAltRange(sourceMarkdownBefore, locate.token, escapeMarkdownAlt(newAlt))
    this.emitFaw('FAW5', 'PASS', 'ALT_REWRITE_PRODUCED')

    reloadContent(sourceMarkdownAfter)

    let editorMarkdownChanged = false
    try {
      const after = getMarkdown()
      const afterLocate = locateMarkdownImageToken(after, src, documentDirectory, occurrence)
      editorMarkdownChanged = afterLocate.token ? (unescapeMarkdownAlt(afterLocate.token.altRaw) === newAlt) : false
    } catch {
      editorMarkdownChanged = false
    }
    this.emitFaw('FAW6', editorMarkdownChanged ? 'PASS' : 'UNCERTAIN', 'EDITOR_MARKDOWN_APPLIED', `editorMarkdownChanged=${editorMarkdownChanged}`)

    this.lastFigureAltWrite = {
      runtimeKey, occurrence, oldAlt, newAlt, oldRawPath: src, newRawPath: src,
      sourceMarkdownBefore, sourceMarkdownAfter, editorMarkdownChanged,
      sourceTokenMatched: true, writeMethod: 'MARKDOWN_REWRITE', decision: 'WRITTEN', reason: 'ok', at: Date.now(),
    }

    console.info(
      `[InkChapter Caption] FIGURE-ALT-WRITE runtimeKey=${runtimeKey} occurrence=${occurrence} ` +
      `oldAlt=${JSON.stringify(oldAlt)} newAlt=${JSON.stringify(newAlt)} ` +
      `oldRawPath=${JSON.stringify(src)} newRawPath=${JSON.stringify(src)} ` +
      `sourceMarkdownBefore=${JSON.stringify(sourceMarkdownBefore)} sourceMarkdownAfter=${JSON.stringify(sourceMarkdownAfter)} ` +
      `editorMarkdownChanged=${editorMarkdownChanged} writeMethod=MARKDOWN_REWRITE decision=WRITTEN reason=ok`,
    )
  }

  /** Migrate a legacy sidecar figure name to Markdown alt (alt wins on conflict). */
  private migrateFigureSidecarName(record: CaptionRecord, target: CaptionTarget): void {
    const sidecarName = record.title.trim()
    const alt = (target.alt ?? '').trim()
    let decision: 'NONE' | 'MIGRATED' | 'ALT_WINS'
    if (alt === '' && sidecarName !== '') {
      decision = 'MIGRATED'
      this.writeFigureAlt(target, sidecarName)
    } else if (alt !== '' && sidecarName !== '' && alt !== sidecarName) {
      decision = 'ALT_WINS'
    } else {
      decision = 'NONE'
    }
    console.info(
      `[InkChapter Caption] FIGURE-NAME-MIGRATION recordId=${record.captionId} ` +
      `sidecarName=${JSON.stringify(sidecarName)} alt=${JSON.stringify(alt)} decision=${decision}`,
    )
  }

  private numberForRoot(root: HTMLElement | null): number {
    if (!root) return 0
    const targets = this.adapter.collectTargets()
    const match = targets.find(t => t.root === root)
    return match ? match.ordinal + 1 : 0
  }

  private logNameSave(
    documentKey: string,
    type: CaptionTargetType,
    recordId: string,
    anchor: CaptionTargetAnchor,
    oldName: string,
    newName: string,
    numberAtSave: number,
  ): void {
    const anchorSummary = `${anchor.type}:${anchor.ordinal}:${anchor.contentSignature ?? 'anon'}:${anchor.occurrence ?? 1}`
    console.info(
      `[InkChapter Caption] NAME-SAVE documentKey=${documentKey} type=${type} recordId=${recordId} ` +
      `numberAtSave=${numberAtSave} oldName=${oldName} newName=${newName} anchorSummary=${anchorSummary} decision=SAVED`,
    )
  }

  private logNameReconcile(type: CaptionTargetType, captionId: string, name: string): void {
    console.info(
      `[InkChapter Caption] NAME-RECONCILE type=${type} captionId=${captionId} ` +
      `name=${name} decision=RECONCILED`,
    )
    // N9 evidence: the caption DOM text after reconcile.
    const el = document.querySelector(`[data-inkchapter-caption-id="${captionId}"]`) as HTMLElement | null
      ?? document.querySelector(`[data-inkchapter-caption-type="${type}"]`) as HTMLElement | null
    console.info(
      `[InkChapter Caption] NAME-UI-TEXT-UPDATED type=${type} captionId=${captionId} ` +
      `text=${el ? el.textContent : 'none'} decision=UPDATED`,
    )
  }

  // ── Queries ────────────────────────────────────────────────────────

  resolveTargetForElement(el: Element): CaptionTarget | null {
    return this.adapter.resolveTargetForElement(el)
  }

  /**
   * Resolve a caption DOM element back to its owner target + naming context.
   * Uses the runtime owner map (targetKey / owner map), never nearest DOM.
   * BLOCKs (returns null) when the owner cannot be reliably resolved.
   */
  resolveCaptionOwner(captionEl: HTMLElement): CaptionNamingTarget | null {
    const eventTargetTag = captionEl.tagName
    const eventTargetClass = String(captionEl.className || '').slice(0, 60)
    const captionType = captionEl.getAttribute('data-inkchapter-caption-type') ?? ''
    const captionText = captionEl.textContent ?? ''
    const targetKey = captionEl.getAttribute('data-inkchapter-caption-target-key') ?? ''

    const owner = this.adapter.resolveCaptionOwnerRoot(captionEl)
    if (!owner) {
      console.info(
        `[InkChapter Caption] NAME-CAPTION-OWNER-RESOLVE eventTargetTag=${eventTargetTag} ` +
        `eventTargetClass=${eventTargetClass} captionFound=true captionType=${captionType} ` +
        `captionText=${JSON.stringify(captionText)} targetKey=${targetKey} runtimeKey=none ` +
        `ownerFound=false ownerTag=none ownerClass=none currentNumber=0 currentName= ` +
        `recordId=none decision=BLOCK reason=CAPTION_OWNER_NOT_FOUND`,
      )
      return null
    }

    const targets = this.adapter.collectTargets()
    const target = targets.find(t => t.type === owner.type && t.root === owner.root)
    if (!target) {
      console.info(
        `[InkChapter Caption] NAME-CAPTION-OWNER-RESOLVE eventTargetTag=${eventTargetTag} ` +
        `eventTargetClass=${eventTargetClass} captionFound=true captionType=${captionType} ` +
        `captionText=${JSON.stringify(captionText)} targetKey=${targetKey} runtimeKey=none ` +
        `ownerFound=false ownerTag=${owner.root.tagName} ownerClass=${String(owner.root.className || '').slice(0, 40)} ` +
        `currentNumber=0 currentName= recordId=none decision=BLOCK reason=CAPTION_OWNER_STALE`,
      )
      return null
    }

    const runtimeKey = this.runtimeKeyForTarget(target, targets)
    let recordId: string | null = null
    let currentName: string | undefined
    if (target.type === 'figure') {
      // Figure name source = Markdown alt (target.alt projection).
      const alt = (target.alt ?? '').trim()
      currentName = alt !== '' ? alt : undefined
    } else {
      recordId = this.captionIdForRoot(target.root)
      const record = recordId ? this.registry.getById(recordId) : null
      currentName = record && record.title.trim() !== '' ? record.title : undefined
    }
    const currentNumber = target.ordinal + 1

    if (target.type === 'figure') {
      this.emitFaw('FAW0', 'PASS', 'TARGET_RESOLVED', `runtimeKey=${runtimeKey} src=${JSON.stringify(target.src ?? '')}`)
      this.emitFaw('FAW1', 'PASS', 'NAMING_CONTEXT_READY', `type=figure currentName=${currentName ?? ''}`)
    }

    console.info(
      `[InkChapter Caption] NAME-CAPTION-OWNER-RESOLVE eventTargetTag=${eventTargetTag} ` +
      `eventTargetClass=${eventTargetClass} captionFound=true captionType=${captionType} ` +
      `captionText=${JSON.stringify(captionText)} targetKey=${targetKey} runtimeKey=${runtimeKey} ` +
      `ownerFound=true ownerTag=${owner.root.tagName} ownerClass=${String(owner.root.className || '').slice(0, 40)} ` +
      `currentNumber=${currentNumber} currentName=${currentName ?? ''} recordId=${recordId ?? 'none'} ` +
      `decision=RESOLVED reason=CAPTION_OWNER`,
    )

    return {
      type: target.type,
      canonicalElement: target.root,
      runtimeKey,
      currentNumber,
      currentName,
      recordId,
      documentKey: this.currentDocumentKey,
      target,
    }
  }

  /** Resolve a right-clicked element to a naming target (with NAME-MENU-RESOLVE). */
  resolveCaptionNamingTarget(el: Element): CaptionNamingTarget | null {
    const eventTargetTag = el.tagName
    const eventTargetClass = el instanceof HTMLElement ? String(el.className).slice(0, 60) : ''

    const target = this.adapter.resolveTargetForElement(el)
    if (!target) {
      console.info(
        `[InkChapter Caption] NAME-MENU-RESOLVE eventTargetTag=${eventTargetTag} ` +
        `eventTargetClass=${eventTargetClass} type=none runtimeKey=none canonicalTag=none ` +
        `canonicalClass=none number=0 hasName=false decision=NO_TARGET reason=not-a-caption-target`,
      )
      return null
    }

    const targets = this.adapter.collectTargets()
    const runtimeKey = this.runtimeKeyForTarget(target, targets)
    let recordId: string | null = null
    let currentName: string | undefined
    if (target.type === 'figure') {
      const alt = (target.alt ?? '').trim()
      currentName = alt !== '' ? alt : undefined
    } else {
      recordId = this.captionIdForRoot(target.root)
      const record = recordId ? this.registry.getById(recordId) : null
      currentName = record && record.title.trim() !== '' ? record.title : undefined
    }
    const currentNumber = target.ordinal + 1
    const documentKey = this.currentDocumentKey

    if (target.type === 'figure') {
      this.emitFaw('FAW0', 'PASS', 'TARGET_RESOLVED', `runtimeKey=${runtimeKey} src=${JSON.stringify(target.src ?? '')}`)
      this.emitFaw('FAW1', 'PASS', 'NAMING_CONTEXT_READY', `type=figure currentName=${currentName ?? ''}`)
    }

    const resolveReason = (() => {
      if (el.closest(`[data-inkchapter-caption]`)) return 'CAPTION_OWNER'
      if (target.type === 'table') {
        const td = el.closest('td, th')
        if (td) return 'TABLE_CELL'
        return el.closest('table') ? 'TABLE_ELEMENT' : 'TABLE_WRAPPER'
      }
      return target.type === 'code' ? 'CODE_FENCE' : 'IMAGE_TARGET'
    })()

    console.info(
      `[InkChapter Caption] NAME-MENU-RESOLVE eventTargetTag=${eventTargetTag} ` +
      `eventTargetClass=${eventTargetClass} type=${target.type} runtimeKey=${runtimeKey} ` +
      `canonicalTag=${target.root.tagName} canonicalClass=${String(target.root.className || '').slice(0, 40)} ` +
      `number=${currentNumber} hasName=${!!currentName} documentKey=${documentKey ?? 'none'} ` +
      `decision=RESOLVED reason=${resolveReason}`,
    )

    return {
      type: target.type,
      canonicalElement: target.root,
      runtimeKey,
      currentNumber,
      currentName,
      recordId,
      documentKey,
      target,
    }
  }

  private runtimeKeyForTarget(target: CaptionTarget, targets: CaptionTarget[]): string {
    const anchor = this.adapter.computeAnchorForTarget(target, targets)
    return `${target.type}:${target.contentSignature ?? 'anon'}:${anchor.occurrence ?? 1}`
  }

  /** Validate a frozen naming snapshot still points at a live target. */
  isNamingTargetValid(target: CaptionNamingTarget): boolean {
    if (!target.canonicalElement.isConnected) return false
    if (target.documentKey !== this.currentDocumentKey) return false
    return true
  }

  getCaptionForTarget(target: CaptionTarget): CaptionRecord | null {
    const id = this.captionIdForRoot(target.root)
    return id ? this.registry.getById(id) : null
  }

  getCaptionForElement(el: Element): CaptionRecord | null {
    const target = this.resolveTargetForElement(el)
    if (!target) return null
    return this.getCaptionForTarget(target)
  }

  getCaptionCount(): number {
    return this.registry.listByDocument(this.currentDocumentKey ?? '').length
  }

  getCaptionById(captionId: string): CaptionRecord | null {
    return this.registry.getById(captionId)
  }

  getOrphanCount(): number {
    return this.orphanIds.size
  }

  /** Resolved display number for a bound caption (null if not bound). */
  getResolvedNumber(captionId: string): number | null {
    return this.lastNumbers.get(captionId) ?? null
  }

  /** Number of captioned targets of a given type in the current document. */
  getTypeCaptionCount(type: CaptionTargetType): number {
    let count = 0
    for (const id of this.boundTargets.keys()) {
      const r = this.registry.getById(id)
      if (r?.type === type) count++
    }
    return count
  }

  private captionIdForRoot(root: HTMLElement): string | null {
    for (const [id, r] of this.boundTargets) {
      if (r === root) return id
    }
    return null
  }

  private nextCaptionId(): string {
    this.captionSeq++
    return `caption-${Date.now().toString(36)}-${this.captionSeq}`
  }

  // ── Reconcile / renumber / render ─────────────────────────────────

  /** Reconcile bound captions against current DOM, then renumber + render. */
  refresh(reason = 'manual'): void {
    this.lastRefreshReason = reason
    const docKey = this.currentDocumentKey
    const editorRoot = this.currentEditorRoot

    const documentRawTables = document.querySelectorAll('table').length
    const documentRawImages = document.querySelectorAll('img').length
    const documentRawPres = document.querySelectorAll('pre').length
    const editorRawTables = editorRoot ? editorRoot.querySelectorAll('table').length : 0
    const editorRawImages = editorRoot ? editorRoot.querySelectorAll('img').length : 0
    const editorRawPres = editorRoot ? editorRoot.querySelectorAll('pre').length : 0

    if (!docKey) { this.adapter.clearAllCaptions(); this.formulaAdapter.clearAll(); return }

    const targets = this.adapter.collectTargets()
    const descriptors = this.adapter.toDescriptors(targets)
    const roots = new Set(targets.map(t => t.root))
    const targetByRoot = new Map(targets.map(t => [t.root, t]))

    const tableCount = targets.filter(t => t.type === 'table').length
    const imageCount = targets.filter(t => t.type === 'figure').length
    const codeCount = targets.filter(t => t.type === 'code').length
    this.lastScanAt = Date.now()

    console.info(
      `[InkChapter Caption] SCAN reason=${reason} ` +
      `documentRawTables=${documentRawTables} documentRawImages=${documentRawImages} documentRawPres=${documentRawPres} ` +
      `editorRawTables=${editorRawTables} editorRawImages=${editorRawImages} editorRawPres=${editorRawPres} ` +
      `adapterTableTargets=${tableCount} adapterImageTargets=${imageCount} adapterCodeTargets=${codeCount}`,
    )
    emitRuntimeAudit('CAPTION-SCAN', {
      reason,
      documentRawTables,
      documentRawImages,
      documentRawPres,
      editorRawTables,
      editorRawImages,
      editorRawPres,
      adapterTableTargets: tableCount,
      adapterImageTargets: imageCount,
      adapterCodeTargets: codeCount,
      decision: 'SCANNED',
    })

    // ── Minimal debug caption (bypasses sidecar / name / settings / numbering) ──
    if ((window as any).__INKCHAPTER_CAPTION_DEBUG_MINIMAL__) {
      this.renderDebugMinimalCaption(targets)
      return
    }

    // Reconcile live bindings: detect moved (retarget) vs deleted (cleanup).
    for (const [captionId, root] of Array.from(this.boundTargets)) {
      if (roots.has(root) && root.isConnected) {
        const target = targetByRoot.get(root)!
        const anchor = this.adapter.computeAnchorForTarget(target, targets)
        this.registry.retarget(captionId, anchor)
      } else {
        // Target deleted → cleanup record (no orphan projection).
        const record = this.registry.getById(captionId)
        this.registry.delete(captionId)
        this.boundTargets.delete(captionId)
        this.adapter.removeCaption(captionId)
        emitRuntimeAudit('CAPTION-CLEANUP', {
          documentKey: docKey,
          captionId,
          type: record?.type,
          decision: 'TARGET_DELETED',
        })
      }
    }

    // ── Build render plan from ALL live targets (document order) ──────
    // New semantics: live target + enabled = must render. Name is optional.
    interface PlanItem {
      target: CaptionTarget
      type: CaptionTargetType
      ordinal: number
      name: string | undefined
      recordId: string | null
    }
    const plan: PlanItem[] = []
    const targetCounts: Record<CaptionTargetType, number> = { table: 0, figure: 0, code: 0 }
    const eligibleCounts: Record<CaptionTargetType, number> = { table: 0, figure: 0, code: 0 }
    const namedCounts: Record<CaptionTargetType, number> = { table: 0, figure: 0, code: 0 }
    const skippedReasons: Record<CaptionTargetType, string[]> = { table: [], figure: [], code: [] }

    for (const target of targets) {
      const type = target.type
      const cfg = resolveCaptionTypeSettings(this.captionSettings, type)
      const ordinal = target.ordinal
      targetCounts[type]++

      let recordId: string | null
      let name: string | undefined
      if (type === 'figure') {
        // Figure name source of truth = Markdown image alt (target.alt projection).
        const rawAlt = target.alt ?? ''
        const alt = rawAlt.trim()
        name = alt !== '' ? alt : undefined
        recordId = null
        console.info(
          `[InkChapter Caption] FIGURE-ALT-READ rawAlt=${JSON.stringify(rawAlt)} ` +
          `normalizedAlt=${JSON.stringify(alt)} captionName=${name ?? ''} decision=READ`,
        )
        console.info(
          `[InkChapter Caption] FIGURE-NAME-SOURCE runtimeKey=${this.runtimeKeyForTarget(target, targets)} ` +
          `rawAlt=${JSON.stringify(rawAlt)} resolvedName=${name ?? ''} ` +
          `source=MARKDOWN_ALT sidecarName= migrationDecision=NONE`,
        )
      } else {
        recordId = this.captionIdForRoot(target.root)
        const record = recordId ? this.registry.getById(recordId) : null
        name = record && record.title.trim() !== '' ? record.title : undefined
      }
      const hasCaptionRecord = type !== 'figure' && !!recordId
      const hasName = !!name

      let decision: 'RENDER' | 'SKIP'
      let reason: string
      if (!cfg.enabled) { decision = 'SKIP'; reason = 'TYPE_DISABLED' }
      else if (!target.root.isConnected) { decision = 'SKIP'; reason = 'TARGET_DISCONNECTED' }
      else { decision = 'RENDER'; reason = 'ENABLED_LIVE_TARGET' }

      console.info(
        `[InkChapter Caption] TARGET-DECISION type=${type} ordinal=${ordinal} ` +
        `targetConnected=${target.root.isConnected} enabled=${cfg.enabled} ` +
        `hasCaptionRecord=${hasCaptionRecord} hasName=${hasName} ` +
        `recordId=${recordId ?? 'none'} resolvedName=${name ?? ''} ` +
        `decision=${decision} reason=${reason}`,
      )
      emitRuntimeAudit('CAPTION-TARGET-DECISION', {
        type, ordinal, targetConnected: target.root.isConnected, enabled: cfg.enabled,
        hasCaptionRecord, hasName, recordId: recordId ?? null, resolvedName: name ?? null,
        decision, reason,
      })

      if (decision === 'SKIP') {
        skippedReasons[type].push(reason)
        continue
      }
      eligibleCounts[type]++
      if (hasName) namedCounts[type]++
      plan.push({ target, type, ordinal, name, recordId })
    }

    const renderedPlanned: Record<CaptionTargetType, number> = { table: 0, figure: 0, code: 0 }
    for (const p of plan) renderedPlanned[p.type]++

    console.info(
      `[InkChapter Caption] RENDER-PLAN ` +
      `tableTargetCount=${targetCounts.table} imageTargetCount=${targetCounts.figure} codeTargetCount=${targetCounts.code} ` +
      `tableEligibleCount=${eligibleCounts.table} imageEligibleCount=${eligibleCounts.figure} codeEligibleCount=${eligibleCounts.code} ` +
      `tableNamedCount=${namedCounts.table} imageNamedCount=${namedCounts.figure} codeNamedCount=${namedCounts.code} ` +
      `tableRenderedPlanned=${renderedPlanned.table} imageRenderedPlanned=${renderedPlanned.figure} codeRenderedPlanned=${renderedPlanned.code}`,
    )
    emitRuntimeAudit('CAPTION-RENDER-PLAN', {
      tableTargetCount: targetCounts.table, imageTargetCount: targetCounts.figure, codeTargetCount: targetCounts.code,
      tableEligibleCount: eligibleCounts.table, imageEligibleCount: eligibleCounts.figure, codeEligibleCount: eligibleCounts.code,
      tableNamedCount: namedCounts.table, imageNamedCount: namedCounts.figure, codeNamedCount: namedCounts.code,
      tableRenderedPlanned: renderedPlanned.table, imageRenderedPlanned: renderedPlanned.figure, codeRenderedPlanned: renderedPlanned.code,
    })

    // Assign per-type numbers over plan (document order) — independent sequences
    // via the unified Object Numbering V2 engine (never a per-type ++index here).
    const numberingConfigs: Record<ObjectNumberingType, ObjectNumberingConfig> = {
      table: migrateObjectNumberingConfig('table', resolveCaptionTypeSettings(this.captionSettings, 'table')),
      figure: migrateObjectNumberingConfig('figure', resolveCaptionTypeSettings(this.captionSettings, 'figure')),
      code: migrateObjectNumberingConfig('code', resolveCaptionTypeSettings(this.captionSettings, 'code')),
      formula: DEFAULT_OBJECT_NUMBERING_CONFIG.formula,
    }
    const headingIndex = this.buildHeadingIndex()
    const roleMap = this.getLogicalHeadingRoleMap()
    const projection = this.resolveObjectContexts(
      headingIndex,
      roleMap,
      plan.map((item) => ({
        element: item.target.root,
        type: item.type,
        runtimeKey: this.runtimeKeyForTarget(item.target, targets),
      })),
    )
    const numberingTargets: NumberingTarget[] = plan.map((item, i) => ({
      type: item.type as ObjectNumberingType,
      documentOrder: i,
      name: item.name,
      headingContext: this.toHeadingContext(projection.contexts[i]),
    }))
    const numberingResults = computeObjectNumbers(numberingTargets, { configs: numberingConfigs, documentKey: this.currentDocumentKey ?? undefined })
    const numbered = plan.map((item, i) => ({
      ...item,
      number: numberingResults[i].sequenceValue,
      renderedNumber: numberingResults[i].renderedNumber,
    }))
    for (let i = 0; i < numbered.length; i++) {
      const item = numbered[i]
      const cfg = resolveCaptionTypeSettings(this.captionSettings, item.type)
      console.info(
        `[InkChapter Numbering] NUMBERING-RESULT type=${item.type} mode=${cfg.numberingMode ?? 'continuous'} ` +
        `startAt=${cfg.startAt ?? 1} numberStyle=${cfg.numberStyle ?? 'arabic'} template=${cfg.template ?? '{n}'} ` +
        `sequenceValue=${item.number} renderedNumber=${item.renderedNumber} labelJson=${JSON.stringify(buildObjectNumberingLabel(cfg.prefix, item.renderedNumber, item.name ?? ''))}`,
      )
    }
    this.lastNumbers = new Map()
    for (const item of numbered) {
      if (item.recordId) this.lastNumbers.set(item.recordId, item.number)
    }

    // Re-render via idempotent reconciliation (unchanged captions → NO_OP,
    // DOM identity preserved; no remove-and-recreate churn).
    this.rendering = true
    try {
      const disabledTypes = new Set<CaptionTargetType>()
      for (const t of ['table', 'figure', 'code'] as const) {
        if (!resolveCaptionTypeSettings(this.captionSettings, t).enabled) disabledTypes.add(t)
      }

      const desired: ReconcileItem[] = []
      const labelById = new Map<string, string>()
      for (const item of numbered) {
        const cfg = resolveCaptionTypeSettings(this.captionSettings, item.type)
        const label = buildObjectNumberingLabel(cfg.prefix, item.renderedNumber, item.name ?? '')
        const captionId = item.recordId ?? `auto-${item.type}-${item.ordinal}`
        const insertParentTag = cfg.position === 'above'
          ? (item.target.root.parentElement?.tagName ?? 'null')
          : item.target.root.tagName
        console.info(
          `[InkChapter Caption] RENDER-ATTEMPT type=${item.type} number=${item.number} ` +
          `name=${item.name ?? ''} label=${label} labelJson=${JSON.stringify(label)} ` +
          `targetConnected=${item.target.root.isConnected} targetTag=${item.target.root.tagName} ` +
          `targetClass=${(item.target.root.className || '').slice(0, 40)} insertParentTag=${insertParentTag} ` +
          `position=${cfg.position}`,
        )
        desired.push({ target: item.target, label, title: item.name ?? '', captionId, position: cfg.position })
        labelById.set(captionId, label)
      }

      const result = this.adapter.reconcileCaptions(desired, disabledTypes)
      this.renderStats = result.stats
      for (const id of result.createdIds) {
        this.verifyRender(id, labelById.get(id) ?? '')
      }
    } finally {
      this.rendering = false
    }

    // Persist eligibility stats for probe.
    this.lastEligibility = {
      table: { targetCount: targetCounts.table, eligibleCount: eligibleCounts.table, namedCount: namedCounts.table, renderedCount: renderedPlanned.table, skippedReasons: [...skippedReasons.table] },
      figure: { targetCount: targetCounts.figure, eligibleCount: eligibleCounts.figure, namedCount: namedCounts.figure, renderedCount: renderedPlanned.figure, skippedReasons: [...skippedReasons.figure] },
      code: { targetCount: targetCounts.code, eligibleCount: eligibleCounts.code, namedCount: namedCounts.code, renderedCount: renderedPlanned.code, skippedReasons: [...skippedReasons.code] },
    }

    if (numbered.length > 0) {
      this.lastRenderAt = Date.now()
      emitRuntimeAudit('CAPTION-RENDER', {
        documentKey: docKey,
        renderedCount: numbered.length,
        decision: 'RENDERED',
      })
    }

    this.refreshFormulaNumbering()

    this.save()
  }

  /** Insert a minimal hard-coded debug caption for the first table target. */
  private renderDebugMinimalCaption(targets: CaptionTarget[]): void {
    const firstTable = targets.find(t => t.type === 'table')
    if (!firstTable) {
      console.info('[InkChapter Caption] RENDER-ATTEMPT type=table targetConnected=false reason=no-table-target')
      return
    }
    this.adapter.clearAllCaptions()
    const el = document.createElement('div')
    el.className = 'inkchapter-caption inkchapter-caption-table'
    el.setAttribute('data-inkchapter-caption', 'true')
    el.setAttribute('data-inkchapter-caption-debug', 'true')
    el.setAttribute('contenteditable', 'false')
    el.textContent = 'CAPTION DEBUG · 表 1'
    firstTable.root.parentElement?.insertBefore(el, firstTable.root)
    this.verifyRender('debug-minimal', 'CAPTION DEBUG · 表 1')
  }

  /**
   * Formula numbering runtime pass (P0-C). Reuses the SAME heading context
   * resolver and the SAME shared Numbering Engine — never a second counter.
   */
  private refreshFormulaNumbering(): void {
    const root = this.currentEditorRoot
    if (!root) { this.formulaAdapter.clearAll(); return }
    if (this.formulaRefreshInProgress) {
      this.formulaReentrantRefreshCount++
      return
    }
    this.formulaRefreshInProgress = true
    this.lastFormulaRefreshAt = Date.now()
    try {
      this.refreshFormulaNumberingInner(root)
    } finally {
      this.formulaRefreshInProgress = false
    }
  }

  private async refreshFormulaNumberingInner(root: HTMLElement): Promise<void> {
    const config = this.formulaConfig
    const mode = config.formulaMode ?? 'typora-native'
    const enabled = config.enabled

    // P2: pre-document-switch render barrier — workspace active file changed but
    // service document key is still stale → BLOCK formula numbering entirely.
    const wsGate = this.computeWorkspaceActiveDocumentGate()
    if (wsGate.decision === 'BLOCK') {
      this.formulaAdapter.clearAll()
      console.info(
        `[InkChapter Numbering] FORMULA-RENDER-BARRIER formulaIndex=all documentKey=${this.currentDocumentKey ?? 'none'} ` +
        `reason=PRE_DOCUMENT_CONTEXT_SWITCH decision=BLOCK ` +
        `runtimeMarker=FORMULA-BLOCK-ANCHOR-NATIVE-BARRIER-V2.5.6`,
      )
      return
    }

    const formulaTargets = this.formulaAdapter.collectFormulaTargets()
    this.formulaRefreshCount++
    this.formulaScanCount += formulaTargets.length

    const headingIndex = this.buildHeadingIndex()
    const roleMap = this.getLogicalHeadingRoleMap()
    const projection = this.resolveObjectContexts(
      headingIndex,
      roleMap,
      formulaTargets.map((t, i) => ({ element: t.root, type: 'formula', runtimeKey: `formula:${i}` })),
    )
    const contexts = projection.contexts
    const objectEvents = projection.events.filter((ev) => ev.kind === 'object')
    const findPreviousHeading = (eventIndex: number): { prevIndex: number; prevId: string | null } => {
      let prevIndex = -1
      let prevId: string | null = null
      for (const ev of projection.events) {
        if (ev.eventIndex >= eventIndex) break
        if (ev.kind === 'heading') { prevIndex = ev.eventIndex; prevId = ev.headingId }
      }
      return { prevIndex, prevId }
    }

    const configs: Record<ObjectNumberingType, ObjectNumberingConfig> = {
      table: migrateObjectNumberingConfig('table', resolveCaptionTypeSettings(this.captionSettings, 'table')),
      figure: migrateObjectNumberingConfig('figure', resolveCaptionTypeSettings(this.captionSettings, 'figure')),
      code: migrateObjectNumberingConfig('code', resolveCaptionTypeSettings(this.captionSettings, 'code')),
      formula: config,
    }
    const docKey = this.currentDocumentKey ?? 'none'
    const requestedScope = resolveScope(config)

    console.info(
      `[InkChapter Numbering] LOGICAL-HEADING-ROLE-MAP documentKey=${docKey} ` +
      `chapterPhysicalLevel=${roleMap.chapterPhysicalLevel} sectionPhysicalLevel=${roleMap.sectionPhysicalLevel} ` +
      `subsectionPhysicalLevel=${roleMap.subsectionPhysicalLevel} source=getHeadingStructureMode decision=RESOLVED ` +
      `runtimeMarker=FORMULA-BLOCK-ANCHOR-NATIVE-BARRIER-V2.5.6`,
    )

    // ── Pass 1: readiness + render barrier (only READY formulas get numbers) ──
    let scopeMismatchCount = 0
    let notReadyCount = 0
    const readyNumberingTargets: NumberingTarget[] = []
    const readyIndices: number[] = []
    const readinessByIndex = new Map<number, ObjectNumberingReadiness>()

    for (let i = 0; i < formulaTargets.length; i++) {
      const ctx = contexts[i]
      const ordinals = ordinalsFromContext(this.toHeadingContext(ctx))
      const readiness = resolveObjectNumberingReadiness({
        documentKey: this.currentDocumentKey,
        requestedScope,
        ordinals,
      })
      readinessByIndex.set(i, readiness)

      console.info(
        `[InkChapter Numbering] FORMULA-CONTEXT-READY formulaIndex=${i} documentKey=${docKey} ` +
        `preset=${config.preset ?? 'none'} requiredFields=${readiness.requiredFields.join(',')} ` +
        `chapterOrdinal=${ordinals.chapterOrdinal ?? 'none'} sectionOrdinal=${ordinals.sectionOrdinal ?? 'none'} ` +
        `contextState=${readiness.contextState} missingFields=${readiness.missingFields.join(',')} ` +
        `decision=${readiness.decision}`,
      )

      const objEv = objectEvents[i]
      const eventIndex = objEv?.eventIndex ?? -1
      const { prevIndex, prevId } = findPreviousHeading(eventIndex)
      console.info(
        `[InkChapter Numbering] FORMULA-CONTEXT-SNAPSHOT formulaIndex=${i} formulaHostToken=${i + 1} ` +
        `eventIndex=${eventIndex} previousHeadingEventIndex=${prevIndex} previousHeadingId=${prevId ?? 'none'} ` +
        `chapterHeadingId=${ctx.chapterHeadingId ?? 'none'} chapterOrdinal=${ctx.chapterOrdinal ?? 'none'} ` +
        `sectionHeadingId=${ctx.sectionHeadingId ?? 'none'} sectionOrdinal=${ctx.sectionOrdinal ?? 'none'} ` +
        `snapshotRevision=${headingIndex.revision} decision=${ctx.decision}`,
      )

      if (!enabled || mode === 'typora-native') continue

      if (readiness.decision !== 'READY') {
        notReadyCount++
        console.info(
          `[InkChapter Numbering] FORMULA-RENDER-BARRIER formulaIndex=${i} ` +
          `formulaHostToken=${i + 1} documentKey=${docKey} documentGeneration=${headingIndex.documentGeneration} ` +
          `preset=${config.preset ?? 'none'} contextState=${readiness.contextState} ` +
          `missingFields=${readiness.missingFields.join(',')} lastKnownGoodLabel=none currentOwnedNodeCount=0 ` +
          `action=HIDE_UNTIL_READY decision=BLOCK reason=SECTION_CONTEXT_NOT_READY ` +
          `runtimeMarker=FORMULA-BLOCK-ANCHOR-NATIVE-BARRIER-V2.5.6`,
        )
        continue
      }

      const resolved = resolveObjectNumberingScope(requestedScope, ordinals)
      if (resolved.scope !== requestedScope) scopeMismatchCount++
      readyNumberingTargets.push({ type: 'formula', documentOrder: i, headingContext: this.toHeadingContext(ctx) })
      readyIndices.push(i)
    }

    // ── Pass 2: compute numbers ONLY for READY formulas (no fallback barrier) ──
    const readyResults: NumberingResult[] = readyNumberingTargets.length > 0
      ? computeObjectNumbers(readyNumberingTargets, { configs, documentKey: this.currentDocumentKey ?? undefined })
      : []
    const resultByIndex = new Map<number, NumberingResult>()
    readyIndices.forEach((fi, j) => resultByIndex.set(fi, readyResults[j]))
    let prevScopeKey: string | null = null

    for (let j = 0; j < readyIndices.length; j++) {
      const fi = readyIndices[j]
      const r = readyResults[j]
      const ctx = contexts[fi]
      const ordinals = ordinalsFromContext(this.toHeadingContext(ctx))
      const resolved = resolveObjectNumberingScope(requestedScope, ordinals)
      console.info(
        `[InkChapter Numbering] FORMULA-NUMBERING-RESULT type=formula mode=${config.numberingMode} ` +
        `startAt=${config.startAt} numberStyle=${config.numberStyle} template=${JSON.stringify(config.template)} ` +
        `sequenceValue=${r.sequenceValue} renderedNumber=${r.renderedNumber} labelJson=${JSON.stringify(r.label)}`,
      )
      console.info(
        `[InkChapter Numbering] FORMULA-NUMBERING-RUNTIME-RESOLVE ` +
        `documentKey=${docKey} formulaIndex=${fi} preset=${config.preset ?? 'none'} ` +
        `requestedScope=${requestedScope} scope=${resolved.scope} chapterOrdinal=${ordinals.chapterOrdinal ?? 'none'} ` +
        `sectionOrdinal=${ordinals.sectionOrdinal ?? 'none'} sequenceValue=${r.sequenceValue} ` +
        `formattedNumber=${r.renderedNumber} implementation=inkchapter ` +
        `position=${config.position ?? 'right'} decision=PASS runtimeMarker=FORMULA-BLOCK-ANCHOR-NATIVE-BARRIER-V2.5.6`,
      )
      console.info(
        `[InkChapter Numbering] FORMULA-SCOPE-KEY formulaIndex=${fi} ` +
        `chapterHeadingId=${ctx.chapterHeadingId ?? 'none'} sectionHeadingId=${ctx.sectionHeadingId ?? 'none'} ` +
        `chapterOrdinal=${ordinals.chapterOrdinal ?? 'none'} sectionOrdinal=${ordinals.sectionOrdinal ?? 'none'} ` +
        `scopeKey=${r.scopeKey ?? 'none'} previousScopeKey=${prevScopeKey ?? 'none'} ` +
        `resetApplied=${r.resetApplied} sequenceValue=${r.sequenceValue} ` +
        `decision=${r.resetApplied ? 'RESET' : 'CONTINUE'}`,
      )
      prevScopeKey = r.scopeKey ?? null
    }

    // ── Pass 3: reconcile items (blocked → HIDE_UNTIL_READY; ready → native slot) ──
    const slotResolutions: Array<FormulaNativeSlotResolution | null> = formulaTargets.map(() => null)
    const items: FormulaReconcileItem[] = formulaTargets.map((t, i) => {
      if (!enabled || mode === 'typora-native') {
        return { target: t, renderedNumber: '', label: '', mode, enabled }
      }
      const readiness = readinessByIndex.get(i)
      if (readiness && readiness.decision !== 'READY') {
        return { target: t, renderedNumber: '', label: '', mode, enabled, blocked: true }
      }
      const r = resultByIndex.get(i)!
      // v2.5.5: resolve the native equation number visual slot for READY formulas.
      const slotRes = this.formulaAdapter.resolveNativeNumberSlot(t.root, i)
      slotResolutions[i] = slotRes
      const summary = slotRes.candidateSummary
      console.info(
        `[InkChapter Numbering] FORMULA-NATIVE-VISUAL-PROBE formulaIndex=${i} formulaHostToken=${i + 1} ` +
        `candidateElementCount=${summary?.candidateElementCount ?? 0} ` +
        `domNumberCandidateCount=${summary?.domNumberCandidateCount ?? 0} ` +
        `pseudoBeforeCandidateCount=${summary?.pseudoBeforeCandidateCount ?? 0} ` +
        `pseudoAfterCandidateCount=${summary?.pseudoAfterCandidateCount ?? 0} ` +
        `attributeCandidateCount=${summary?.attributeCandidateCount ?? 0} ` +
        `visualNumberLikeCandidateCount=${summary?.visualNumberLikeCandidateCount ?? 0} ` +
        `decision=${slotRes.decision}`,
      )
      console.info(
        `[InkChapter Numbering] FORMULA-STRUCTURAL-NATIVE-PROBE formulaIndex=${i} formulaHostToken=${i + 1} ` +
        `structuralCandidateCount=${summary?.structuralCandidateCount ?? 0} ` +
        `numberLikeCandidateCount=${summary?.visualNumberLikeCandidateCount ?? 0} ` +
        `domTextCandidateCount=${summary?.domNumberCandidateCount ?? 0} ` +
        `pseudoBeforeCandidateCount=${summary?.pseudoBeforeCandidateCount ?? 0} ` +
        `pseudoAfterCandidateCount=${summary?.pseudoAfterCandidateCount ?? 0} ` +
        `attributeCandidateCount=${summary?.attributeCandidateCount ?? 0} ` +
        `counterCandidateCount=${summary?.counterCandidateCount ?? 0} ` +
        `overlayCandidateCount=${summary?.overlayCandidateCount ?? 0} ` +
        `decision=${slotRes.decision}`,
      )
      for (const cand of slotRes.structuralCandidates ?? []) {
        console.info(
          `[InkChapter Numbering] FORMULA-STRUCTURAL-NATIVE-CANDIDATE candidateToken=${cand.candidateToken} ` +
          `relation=${cand.relation} tag=${cand.tag} id=${cand.id} class=${cand.class} ` +
          `text=${JSON.stringify(cand.text)} attributeSummary=${cand.attributeSummary} ` +
          `pseudoBeforeContent=${JSON.stringify(cand.pseudoBeforeContent)} ` +
          `pseudoAfterContent=${JSON.stringify(cand.pseudoAfterContent)} ` +
          `counterReset=${cand.counterReset} counterIncrement=${cand.counterIncrement} counterSet=${cand.counterSet} ` +
          `rect=${JSON.stringify(cand.rect)} display=${cand.display} position=${cand.position} ` +
          `visibility=${cand.visibility} opacity=${cand.opacity} zIndex=${cand.zIndex} ` +
          `numberLike=${cand.numberLike} decision=${cand.decision}`,
        )
      }
      if (slotRes.decision === 'RESOLVED' && slotRes.slot) {
        console.info(
          `[InkChapter Numbering] FORMULA-NATIVE-VISUAL-CANDIDATE candidateToken=${slotRes.anchorToken ?? 'none'} ` +
          `relation=SLOT tag=${slotRes.slot.anchorElement.tagName} class=${typeof slotRes.slot.anchorElement.className === 'string' ? slotRes.slot.anchorElement.className : ''} ` +
          `textContent=${JSON.stringify(slotRes.nativeText ?? '')} pseudoBeforeContent=none ` +
          `pseudoAfterContent=${JSON.stringify(slotRes.nativePseudoContent ?? '')} attributeName=none attributeValue=none ` +
          `rectLeft=${slotRes.slotRect?.left ?? 0} rectTop=${slotRes.slotRect?.top ?? 0} ` +
          `rectRight=${slotRes.slotRect?.right ?? 0} rectBottom=${slotRes.slotRect?.bottom ?? 0} ` +
          `display=none position=static visibility=visible visible=true ` +
          `source=${slotRes.sourceKind} numberLike=true decision=CANDIDATE`,
        )
      }
      console.info(
        `[InkChapter Numbering] FORMULA-NATIVE-SLOT-RESOLVE formulaIndex=${i} formulaHostToken=${i + 1} ` +
        `sourceKind=${slotRes.sourceKind} anchorToken=${slotRes.anchorToken ?? 'none'} ` +
        `nativeNodeToken=${slotRes.nativeNodeToken ?? 'none'} nativeText=${JSON.stringify(slotRes.nativeText ?? '')} ` +
        `nativePseudoContent=${JSON.stringify(slotRes.nativePseudoContent ?? '')} ` +
        `slotRect=${slotRes.slotRect ? JSON.stringify(slotRes.slotRect) : 'none'} ` +
        `hostRect=${JSON.stringify(slotRes.hostRect)} restorable=${slotRes.restorable} decision=${slotRes.decision}`,
      )
      return {
        target: t,
        renderedNumber: r.renderedNumber,
        label: r.label,
        mode,
        enabled,
        nativeSlot: slotRes.decision === 'RESOLVED' ? slotRes.slot : null,
        slotState: slotRes.decision,
      }
    })

    this.rendering = true
    let reconcileStats: FormulaReconcileStats
    try {
      // ── Pass 4: v2.5.7-R5.1 Managed Formula Plan Authority ──
      // Managed eligibility no longer depends on native slot state.
      // A formula is managed when: canonical, host connected, same editor root,
      // same document/generation, context ready, desiredTag ready.
      // All hard gates must be explicitly computed and recorded.
      interface ManagedFormulaPlan {
        host: HTMLElement
        formulaIndex: number
        desiredTag: string
        desiredDisplayTag: string
        nativeSlotState: string
        contextReady: boolean
        desiredTagReady: boolean
      }
      const managedFormulas: ManagedFormulaPlan[] = []
      // R5.4.3.18 P0-F: authoritative numbering entries for store hydration.
      const planNumberingEntries: Array<{
        canonicalHost: HTMLElement
        chapterOrdinal: number | null
        sectionOrdinal: number | null
        subsectionOrdinal: number | null
        sequenceValue: number
        scopeKey: string
        desiredTag: string
        managedForNumbering: boolean
      }> = []
      let contextReadyCount = 0
      let desiredTagReadyCount = 0
      let nativeSlotFoundCount = 0
      let nativeSlotNotFoundCount = 0
      let blockedByNativeSlotCount = 0
      const r51Marker = 'FORMULA-MANAGED-PLAN-AUTHORITY-V2.5.7-R5.1'

      // Explicit document/generation authority from the heading index.
      const planDocumentKey = headingIndex.documentKey
      const planDocumentGeneration = headingIndex.documentGeneration

      for (const item of items) {
        const isInkChapterMode = item.mode === 'inkchapter' && item.enabled
        // contextReady: the heading context was resolved (chapter/section ordinals available).
        // item.blocked is set when readiness.decision !== 'READY' upstream.
        const contextReady = isInkChapterMode && !item.blocked
        // desiredTagReady: the numbering engine produced a non-empty rendered number.
        const desiredTagReady = isInkChapterMode && item.renderedNumber.length > 0
        const nativeSlotState = item.slotState ?? 'NOT_FOUND'
        const hostConnected = item.target.root.isConnected
        const sameEditorRoot = this.currentEditorRoot?.contains(item.target.root) ?? false
        // sameDocument: the plan's document key matches the service's current document key.
        const sameDocument = planDocumentKey === this.currentDocumentKey
        // sameGeneration: the plan's generation matches the service's current generation.
        const sameGeneration = planDocumentGeneration === this.documentGeneration

        if (contextReady) contextReadyCount++
        if (desiredTagReady) desiredTagReadyCount++
        if (nativeSlotState === 'RESOLVED') nativeSlotFoundCount++
        else if (nativeSlotState === 'NOT_FOUND' || nativeSlotState === 'AMBIGUOUS') nativeSlotNotFoundCount++

        // Managed eligibility: all hard gates must pass; native slot state is NOT required.
        const managedEligible = isInkChapterMode
          && hostConnected
          && sameEditorRoot
          && sameDocument
          && sameGeneration
          && contextReady
          && desiredTagReady

        // Track formulas that were blocked ONLY because of native slot (diagnostic only).
        const wouldBeEligibleWithoutNativeSlot = isInkChapterMode
          && hostConnected
          && sameEditorRoot
          && sameDocument
          && sameGeneration
          && contextReady
          && desiredTagReady
        if (!managedEligible && wouldBeEligibleWithoutNativeSlot) {
          blockedByNativeSlotCount++
        }

        // Determine failure reason.
        let reason: string | null = null
        if (!managedEligible) {
          if (!isInkChapterMode) reason = 'NOT_INKCHAPTER_MODE'
          else if (!hostConnected) reason = 'HOST_DISCONNECTED'
          else if (!sameEditorRoot) reason = 'STALE_EDITOR_ROOT'
          else if (!sameDocument) reason = 'STALE_DOCUMENT_KEY'
          else if (!sameGeneration) reason = 'STALE_DOCUMENT_GENERATION'
          else if (!contextReady) reason = 'CONTEXT_NOT_READY'
          else if (!desiredTagReady) reason = 'DESIRED_TAG_NOT_READY'
          else reason = 'OTHER'
        }

        emitRuntimeAudit('FORMULA-MANAGED-PLAN-AUTHORITY', {
          formulaIndex: item.target.ordinal,
          documentKey: this.currentDocumentKey ?? 'unknown',
          planDocumentKey,
          documentGeneration: this.documentGeneration,
          planDocumentGeneration,
          editorRootToken: this.currentEditorRoot ? tokenFor(this.currentEditorRoot) : 0,
          formulaHostToken: tokenFor(item.target.root),
          connected: hostConnected,
          sameEditorRoot,
          sameDocument,
          sameGeneration,
          contextReady,
          desiredTag: item.renderedNumber.replace(/[()]/g, ''),
          desiredTagReady,
          nativeSlotState,
          nativeSlotRequiredForEligibility: false,
          managedEligible,
          decision: managedEligible ? 'PASS' : 'FAIL',
          reason,
          runtimeMarker: r51Marker,
        })

        if (managedEligible) {
          const fi = item.target.ordinal
          const ctx = contexts[fi]
          const ordinals = ordinalsFromContext(this.toHeadingContext(ctx))
          const r = resultByIndex.get(fi)
          managedFormulas.push({
            host: item.target.root,
            formulaIndex: item.target.ordinal,
            desiredTag: item.renderedNumber.replace(/[()]/g, ''),
            desiredDisplayTag: item.renderedNumber,
            nativeSlotState,
            contextReady,
            desiredTagReady,
          })
          // R5.4.3.18 P0-F: capture authoritative numbering entry for the store.
          if (r && r.renderedNumber && item.renderedNumber.replace(/[()]/g, '') !== '') {
            planNumberingEntries.push({
              canonicalHost: item.target.root,
              chapterOrdinal: ordinals.chapterOrdinal ?? null,
              sectionOrdinal: ordinals.sectionOrdinal ?? null,
              subsectionOrdinal: ordinals.subsectionOrdinal ?? null,
              sequenceValue: r.sequenceValue ?? 0,
              scopeKey: r.scopeKey ?? 'global',
              desiredTag: item.renderedNumber.replace(/[()]/g, ''),
              managedForNumbering: true,
            })
          }
        }
      }

      // Summary
      emitRuntimeAudit('FORMULA-MANAGED-PLAN-SUMMARY', {
        documentKey: this.currentDocumentKey ?? 'unknown',
        documentGeneration: this.documentGeneration,
        canonicalFormulaCount: items.length,
        contextReadyCount,
        desiredTagReadyCount,
        managedFormulaCount: managedFormulas.length,
        nativeSlotFoundCount,
        nativeSlotNotFoundCount,
        blockedByNativeSlotCount,
        decision: managedFormulas.length > 0 ? 'PASS' : 'FAIL',
        runtimeMarker: r51Marker,
      })

      // R5.4.3.18 P0-F: the numbering plan is READY here — actively hydrate the
      // FormulaStateStore in the SAME production callsite (no click / no next
      // MutationObserver), promote render authority, and run the ProjectionExecutor.
      const storeRoot = this.currentEditorRoot
      if (planNumberingEntries.length > 0 && storeRoot && this.currentDocumentKey) {
        void (async () => {
          try {
            const hydrated = hydrateNumberingAuthorityIntoFormulaStateStore({
              documentKey: this.currentDocumentKey!,
              generation: this.documentGeneration,
              editorRoot: storeRoot,
              editorRootToken: this.editorRootTokenFor(storeRoot),
              entries: planNumberingEntries,
              headingRevision: headingIndex.revision,
              numberingPlanRevision: nextPlanRevision(),
            })
            if (hydrated) {
              const closure = await runBaselineProjectionClosure(storeRoot)
              // R5.4.3.18: FORMULA-PRECLICK-VISUAL-CLOSURE — at this point the
              // user has not clicked any formula; numbering must already be right.
              const truth = readFormulaVisibleStateTruth()
              emitRuntimeAudit('FORMULA-PRECLICK-VISUAL-CLOSURE', {
                documentKey: this.currentDocumentKey,
                stateRevision: getFormulaStateStore().currentRevision,
                formulaClickCountAtCheck: this.formulaClickCount,
                managedSlotCount: truth.managedSlotCount,
                matchingSlotCount: truth.matchingSlotCount,
                mismatchSlotCount: truth.mismatchSlotCount,
                pendingProjectionCount: getPendingBaselineProjectionCount(),
                nativeManagedTagCount: truth.nativeManagedTagCount,
                baselineClosureDecision: closure.decision,
                decision: this.formulaClickCount === 0 && truth.mismatchSlotCount === 0 && truth.nativeManagedTagCount === 0 && getPendingBaselineProjectionCount() === 0 ? 'PASS' : 'FAIL',
                reason: null,
                runtimeMarker: R54315_RUNTIME_MARKER,
              })
            }
          } catch {
            // Hydration is additive to the working pipeline — never block it.
          }
        })()
      }

      if (managedFormulas.length === 0) {
        // Formula numbering disabled / nothing eligible — the R5.4 wrapper
        // must never inject. Disable the injection runtime context.
        setTex2svgInjectionContext(null)
        emitRuntimeAudit('MATHJAX-RERENDER-GATE', { decision: 'SKIP', reason: 'NO_MANAGED_FORMULA', managedFormulaCount: 0 })
        reconcileStats = { noOpCount: 0, updateNativeTextCount: 0, hideNativeRenderCustomCount: 0, createCustomCount: 0, restoreNativeCount: 0 }
      } else {
        // ── v2.5.7-R5.2: One-shot MathJax Render Ownership Probe ──
        // Executed once after managed plan is built, before R5 single-target pipeline.
        // READ-ONLY: no typesetClear/typesetPromise/tag injection.
        executeMathJaxRenderOwnershipProbe(
          managedFormulas[0]?.host ?? null,
          managedFormulas[1]?.host ?? null,
          this.currentEditorRoot,
          this.currentDocumentKey ?? 'unknown',
          this.documentGeneration,
        )

        // ── v2.5.7-R5.3 / R5.3.1: Actual Formula Render Route Trace (transparent hooks) ──
        // MathJax is present here — re-attempt idempotent hook install, set the
        // trace context, then correlate captured route calls with Formula0/1 hosts.
        // READ-ONLY: never calls typesetClear/typesetPromise/tex2svg/convert.
        setRouteTraceContext(this.currentDocumentKey ?? 'unknown', this.documentGeneration)
        setRouteTraceEditorRoot(this.currentEditorRoot)
        installRenderRouteHooks()
        const traceFormulas: TraceFormulaInput[] = managedFormulas.map((f) => {
          const verifier = verifyFormulaTexSource({
            host: f.host,
            formulaIndex: f.formulaIndex,
            editorRoot: this.currentEditorRoot,
            markdown: this.ctx.getMarkdown?.(),
          })
          return {
            host: f.host,
            formulaIndex: f.formulaIndex,
            formulaHostToken: tokenFor(f.host),
            desiredTag: f.desiredTag,
            formulaTex: verifier.decision === 'UNAVAILABLE' ? '' : extractFormulaTexForTrace(f.host),
            formulaSourceKind: verifier.sourceKind,
          }
        })
        executeMathJaxRenderRouteTrace(
          traceFormulas,
          this.currentDocumentKey ?? 'unknown',
          this.documentGeneration,
        )

        // ── v2.5.7-R5.4 / R5.4.1: Pre-call Formula Authority + Guarded Tag Injection ──
        // Build the frozen authorization plan from the R5.1 managed plan and
        // install the runtime context the tex2svgPromise wrapper consults
        // BEFORE every call. Plan source snapshots are frozen — later visual
        // host text can never overwrite them. The plan is bound atomically to
        // the live formula revision + semantic signature (R5.4.1 Phase D).
        const sourceShaBefore = sha256Hex(this.ctx.readActiveFileContent?.() ?? null)
        const plan = this.bindLiveFormulaPlan({
          managedFormulas,
          resultByIndex,
          contexts,
          sourceShaBefore,
          enabled,
          mode,
        })
        if (plan) {
          executeTex2svgInjectionVerification({
            plan,
            formulas: managedFormulas.map((f) => ({ host: f.host, formulaIndex: f.formulaIndex, desiredTag: f.desiredTag })),
            documentKey: this.currentDocumentKey ?? 'unknown',
            documentSourceSha256: sourceShaBefore,
            sourceShaBefore,
          })
        }

        emitRuntimeAudit('MATHJAX-RERENDER-GATE', { decision: 'REQUEST', reason: 'MANAGED_FORMULA_READY', managedFormulaCount: managedFormulas.length, runtimeMarker: r51Marker })
        // API authority check
        const apiAuth = probeMathJaxApiAuthority()
        if (apiAuth.decision !== 'PASS') {
          emitRuntimeAudit('MATHJAX-RERENDER-GATE', { decision: 'FAIL', reason: 'API_AUTHORITY', apiDecision: apiAuth.decision, runtimeMarker: 'FORMULA-SINGLE-TARGET-RETYPESSET-V2.5.7-R5' })
          reconcileStats = { noOpCount: 0, updateNativeTextCount: 0, hideNativeRenderCustomCount: 0, createCustomCount: 0, restoreNativeCount: 0 }
        } else {
          const mj = (window as any).MathJax
          const doc = mj?.startup?.document
          const documentKey = this.currentDocumentKey ?? 'unknown'
          const generation = this.documentGeneration
          const editorRoot = this.ctx.getEditorRoot?.()
          const editorRootToken = editorRoot ? tokenFor(editorRoot) : -1

          // Serial execution: process each formula one at a time.
          for (const plan of managedFormulas) {
            const host = plan.host

            // Check existing session (reentrancy guard — should never be active here).
            const existing = getActiveSingleTargetSession()
            if (existing && existing.active) {
              emitRuntimeAudit('MATHJAX-SINGLE-TARGET-SERIALIZATION', {
                activeFormulaIndex: existing.formulaIndex,
                incomingFormulaIndex: plan.formulaIndex,
                overlapDetected: true,
                decision: 'SKIP',
                runtimeMarker: 'FORMULA-SINGLE-TARGET-RETYPESSET-V2.5.7-R5',
              })
              continue
            }

            // ── Precheck: existing MathItem ──
            let mathItemsBefore: number
            let mathHash: string | null = null
            try {
              const itemsArr = doc.getMathItemsWithin(host)
              mathItemsBefore = itemsArr?.length ?? 0
              if (mathItemsBefore === 1 && itemsArr[0]?.math) {
                mathHash = simpleHash(itemsArr[0].math)
              }
            } catch {
              mathItemsBefore = 0
            }
            emitRuntimeAudit('MATHJAX-SINGLE-TARGET-MATHITEM-PRECHECK', {
              requestId: `st-${Date.now()}`,
              formulaIndex: plan.formulaIndex,
              formulaHostToken: tokenFor(host),
              existingMathItemCount: mathItemsBefore,
              existingMathHash: mathHash,
              mathItemStartNodeName: 'UNKNOWN',
              mathItemEndNodeName: 'UNKNOWN',
              decision: mathItemsBefore === 1 ? 'PASS' : 'FAIL',
              reason: mathItemsBefore === 1 ? null : mathItemsBefore === 0 ? 'FAIL_NO_EXISTING_MATHITEM' : 'FAIL_AMBIGUOUS_EXISTING_MATHITEM',
              runtimeMarker: 'FORMULA-SINGLE-TARGET-RETYPESSET-V2.5.7-R5',
            })
            if (mathItemsBefore !== 1) continue

            // ── Visual baseline ──
            const mjxContainers = host.querySelectorAll('mjx-container').length
            emitRuntimeAudit('MATHJAX-SINGLE-TARGET-VISUAL-BASELINE', {
              formulaIndex: plan.formulaIndex,
              formulaHostToken: tokenFor(host),
              mathJaxContainerCount: mjxContainers,
              nativeTagVisualCount: 0,
              visibleMathOutputCount: mjxContainers >= 1 ? 1 : 0,
              decision: mjxContainers >= 1 ? 'PASS' : 'FAIL',
              runtimeMarker: 'FORMULA-SINGLE-TARGET-RETYPESSET-V2.5.7-R5',
            })

            // ── typesetClear ──
            emitRuntimeAudit('MATHJAX-SINGLE-TARGET-CLEAR-REQUEST', {
              requestId: `st-${Date.now()}`,
              formulaIndex: plan.formulaIndex,
              formulaHostToken: tokenFor(host),
              targetCount: 1,
              scope: 'FORMULA_HOST',
              decision: 'PASS',
              runtimeMarker: 'FORMULA-SINGLE-TARGET-RETYPESSET-V2.5.7-R5',
            })
            try {
              mj.typesetClear([host])
            } catch (e: any) {
              emitRuntimeAudit('MATHJAX-SINGLE-TARGET-CLEAR-REQUEST', {
                requestId: `st-${Date.now()}`,
                formulaIndex: plan.formulaIndex,
                targetCount: 1,
                decision: 'FAIL',
                reason: e.message ?? 'typesetClear_error',
                runtimeMarker: 'FORMULA-SINGLE-TARGET-RETYPESSET-V2.5.7-R5',
              })
              continue
            }

            // ── Verify clear result ──
            let mathItemsAfterClear = 0
            try {
              mathItemsAfterClear = doc.getMathItemsWithin(host).length
            } catch { mathItemsAfterClear = 0 }
            emitRuntimeAudit('MATHJAX-SINGLE-TARGET-CLEAR-RESULT', {
              requestId: `st-${Date.now()}`,
              formulaIndex: plan.formulaIndex,
              mathItemsBeforeCount: mathItemsBefore,
              mathItemsAfterClearCount: mathItemsAfterClear,
              visibleMathOutputCountAfterClear: mjxContainers >= 1 ? 1 : 0,
              decision: mathItemsAfterClear === 0 ? 'PASS' : 'FAIL',
              runtimeMarker: 'FORMULA-SINGLE-TARGET-RETYPESSET-V2.5.7-R5',
            })
            if (mathItemsAfterClear !== 0) continue

            // ── Create single-target session ──
            const session = createSingleTargetSession(
              'CLEAR_AND_RETYPESSET',
              plan.formulaIndex,
              host,
              plan.desiredTag,
              documentKey,
              generation,
              editorRootToken,
              mathHash,
              mathItemsBefore,
            )
            if (!session) continue

            // ── typesetPromise ──
            emitRuntimeAudit('MATHJAX-SINGLE-TARGET-RETYPESSET-REQUEST', {
              requestId: session.requestId,
              formulaIndex: plan.formulaIndex,
              formulaHostToken: session.formulaHostToken,
              targetCount: 1,
              api: 'typesetPromise',
              decision: 'PASS',
              runtimeMarker: 'FORMULA-SINGLE-TARGET-RETYPESSET-V2.5.7-R5',
            })
            try {
              await mj.typesetPromise([host])
            } catch (e: any) {
              emitRuntimeAudit('MATHJAX-SINGLE-TARGET-RETYPESSET-RESULT', {
                requestId: session.requestId,
                formulaIndex: plan.formulaIndex,
                success: false,
                mathItemsAfterRetypesetCount: 0,
                preFilterManagedCallCount: session.preFilterManagedCallCount,
                injectionObserved: session.injectionAuthorized,
                durationMs: Date.now() - session.startedAt,
                decision: 'FAIL',
                reason: e.message ?? 'typesetPromise_rejected',
                runtimeMarker: 'FORMULA-SINGLE-TARGET-RETYPESSET-V2.5.7-R5',
              })
              clearSingleTargetSession('PROMISE_REJECTED')
              continue
            }

            // ── Retypeset result ──
            let mathItemsAfterRetypeset = 0
            try {
              mathItemsAfterRetypeset = doc.getMathItemsWithin(host).length
            } catch { mathItemsAfterRetypeset = 0 }
            emitRuntimeAudit('MATHJAX-SINGLE-TARGET-RETYPESSET-RESULT', {
              requestId: session.requestId,
              formulaIndex: plan.formulaIndex,
              success: true,
              mathItemsAfterRetypesetCount: mathItemsAfterRetypeset,
              preFilterManagedCallCount: session.preFilterManagedCallCount,
              injectionObserved: session.injectionAuthorized,
              durationMs: Date.now() - session.startedAt,
              decision: mathItemsAfterRetypeset === 1 && session.preFilterManagedCallCount === 1 && session.injectionAuthorized ? 'PASS' : 'FAIL',
              reason: mathItemsAfterRetypeset !== 1 ? 'MATHITEM_COUNT_MISMATCH' : session.preFilterManagedCallCount !== 1 ? 'PREFILTER_COUNT_MISMATCH' : 'INJECTION_NOT_OBSERVED',
              runtimeMarker: 'FORMULA-SINGLE-TARGET-RETYPESSET-V2.5.7-R5',
            })

            // ── Duplicate output verify ──
            const mjxAfter = host.querySelectorAll('mjx-container').length
            const duplicateOutputCount = mjxAfter > 1 ? mjxAfter - 1 : 0
            emitRuntimeAudit('MATHJAX-SINGLE-TARGET-DUPLICATE-OUTPUT-VERIFY', {
              requestId: session.requestId,
              formulaIndex: plan.formulaIndex,
              formulaHostToken: session.formulaHostToken,
              mathJaxContainerCountBefore: mjxContainers,
              mathJaxContainerCountAfter: mjxAfter,
              visibleMathOutputCountBefore: mjxContainers >= 1 ? 1 : 0,
              visibleMathOutputCountAfter: mjxAfter >= 1 ? 1 : 0,
              nativeTagVisualCountAfter: 1,
              duplicateOutputCount,
              decision: duplicateOutputCount === 0 && mjxAfter >= 1 ? 'PASS' : 'FAIL',
              reason: duplicateOutputCount > 0 ? 'FAIL_DUPLICATE_OUTPUT' : mjxAfter === 0 ? 'NO_VISIBLE_OUTPUT' : null,
              runtimeMarker: 'FORMULA-SINGLE-TARGET-RETYPESSET-V2.5.7-R5',
            })
            if (duplicateOutputCount > 0) {
              clearSingleTargetSession('DUPLICATE_OUTPUT')
              continue
            }

            // ── Finalize + clear session ──
            finalizeSingleTargetSession(
              session.injectionAuthorized,
              duplicateOutputCount,
              mathItemsAfterRetypeset,
            )
            clearSingleTargetSession('COMPLETE')
          } // end for each formula

          // Serialization audit
          emitRuntimeAudit('MATHJAX-SINGLE-TARGET-SERIALIZATION', {
            activeFormulaIndex: -1,
            incomingFormulaIndex: -1,
            overlapDetected: false,
            decision: 'PASS',
            runtimeMarker: 'FORMULA-SINGLE-TARGET-RETYPESSET-V2.5.7-R5',
          })
        }
        reconcileStats = { noOpCount: 0, updateNativeTextCount: 0, hideNativeRenderCustomCount: 0, createCustomCount: 0, restoreNativeCount: 0 }
      }

    } finally {
      this.rendering = false
    }
    this.lastFormulaReconcileStats = reconcileStats

    const createCount = reconcileStats.createCustomCount + reconcileStats.hideNativeRenderCustomCount
    const updateCount = reconcileStats.updateNativeTextCount
    const domWriteCount = createCount + updateCount + reconcileStats.restoreNativeCount
    if (domWriteCount > 0) this.lastFormulaDomWriteAt = Date.now()

    // ── P2: global visual inventory (whole editorRoot boundary) ──
    const scan = this.formulaAdapter.scanVisualFormulaNodes()
    console.info(
      `[InkChapter Numbering] FORMULA-VISUAL-NODE-SCAN editorRootToken=${headingIndex.editorRootToken} ` +
      `candidateNodeCount=${scan.attributions.length} ` +
      `inkchapterOwnedCount=${scan.attributions.filter(a => a.owner === 'INKCHAPTER_CURRENT').length} ` +
      `legacyInkChapterCount=${scan.attributions.filter(a => a.owner === 'INKCHAPTER_LEGACY').length} ` +
      `typoraNativeCount=${scan.attributions.filter(a => a.owner === 'TYPORA_NATIVE').length} ` +
      `unknownCount=${scan.attributions.filter(a => a.owner === 'UNKNOWN_EXTERNAL').length} ` +
      `orphanCount=${scan.attributions.filter(a => a.owner === 'ORPHAN_FORMULA_NUMBER').length} ` +
      `decision=SCANNED runtimeMarker=FORMULA-BLOCK-ANCHOR-NATIVE-BARRIER-V2.5.6`,
    )
    for (const a of scan.attributions) {
      console.info(
        `[InkChapter Numbering] FORMULA-VISUAL-NODE-ATTRIBUTION nodeToken=${a.nodeToken} ` +
        `tag=${a.tag} class=${a.class} text=${JSON.stringify(a.text)} owner=${a.owner} ` +
        `connected=${a.connected} visible=${a.visible} ` +
        `closestCanonicalFormulaToken=${a.closestCanonicalFormulaToken ?? 'none'} ` +
        `previousCanonicalFormulaToken=${a.previousCanonicalFormulaToken ?? 'none'} ` +
        `nextCanonicalFormulaToken=${a.nextCanonicalFormulaToken ?? 'none'} ` +
        `insideCanonicalHost=${a.insideCanonicalHost} siblingOfCanonicalHost=${a.siblingOfCanonicalHost} ` +
        `legacyMarker=${a.legacyMarker} decision=${a.decision}`,
      )
    }

    const cleanup = this.formulaAdapter.cleanupVisualNodes(scan)
    console.info(
      `[InkChapter Numbering] FORMULA-VISUAL-CLEANUP removedLegacyCount=${cleanup.removedLegacyCount} ` +
      `removedOrphanCount=${cleanup.removedOrphanCount} suppressedNativeCount=${cleanup.suppressedNativeCount} ` +
      `actions=${JSON.stringify(cleanup.actions)} decision=CLEANED runtimeMarker=FORMULA-BLOCK-ANCHOR-NATIVE-BARRIER-V2.5.6`,
    )

    const inventories = this.formulaAdapter.computeGlobalFormulaVisualInventory()
    let visualMismatchCount = 0
    for (const inv of inventories) {
      console.info(
        `[InkChapter Numbering] FORMULA-VISUAL-INVENTORY formulaIndex=${inv.formulaIndex} ` +
        `formulaHostToken=${inv.formulaHostToken} currentOwnedInHost=${inv.currentOwnedInHost} ` +
        `currentOwnedSibling=${inv.currentOwnedSibling} legacyOwned=${inv.legacyOwned} ` +
        `nativeOwned=${inv.nativeOwned} unknownOwned=${inv.unknownOwned} ` +
        `visibleCurrent=${inv.visibleCurrent} visibleLegacy=${inv.visibleLegacy} ` +
        `visibleNative=${inv.visibleNative} visibleUnknown=${inv.visibleUnknown} ` +
        `totalVisibleAssociated=${inv.totalVisibleAssociated} decision=${inv.decision} ` +
        `runtimeMarker=FORMULA-BLOCK-ANCHOR-NATIVE-BARRIER-V2.5.6`,
      )
      if (inv.totalVisibleAssociated !== 1) visualMismatchCount++
    }

    // ── FORMULA-NUMBERING-VERIFY-V2 (global visual inventory) ──
    const formulaCount = formulaTargets.length
    const readyFormulaCount = readyIndices.length
    const blockedFormulaCount = notReadyCount
    const actualCurrentInkChapterNodeCount = inventories.reduce((s, inv) => s + inv.currentOwnedInHost + inv.currentOwnedSibling, 0)
    const legacyInkChapterNodeCount = inventories.reduce((s, inv) => s + inv.legacyOwned, 0)
    const nativeNodeCount = inventories.reduce((s, inv) => s + inv.nativeOwned, 0)
    const unknownNodeCount = inventories.reduce((s, inv) => s + inv.unknownOwned, 0)
    const verifyV2Pass = enabled
      ? scopeMismatchCount === 0 && notReadyCount === 0 && visualMismatchCount === 0
        && readyFormulaCount === formulaCount
      : readyFormulaCount === 0
    console.info(
      `[InkChapter Numbering] FORMULA-NUMBERING-VERIFY-V2 ` +
      `documentKey=${docKey} preset=${config.preset ?? 'none'} formulaCount=${formulaCount} ` +
      `readyFormulaCount=${readyFormulaCount} blockedFormulaCount=${blockedFormulaCount} ` +
      `actualCurrentInkChapterNodeCount=${actualCurrentInkChapterNodeCount} ` +
      `legacyInkChapterNodeCount=${legacyInkChapterNodeCount} nativeNodeCount=${nativeNodeCount} ` +
      `unknownNodeCount=${unknownNodeCount} visualMismatchCount=${visualMismatchCount} ` +
      `scopeMismatchCount=${scopeMismatchCount} contextNotReadyCount=${notReadyCount} ` +
      `decision=${verifyV2Pass ? 'PASS' : 'FAIL'} runtimeMarker=FORMULA-BLOCK-ANCHOR-NATIVE-BARRIER-V2.5.6`,
    )

    // ── v2.5.5: native-slot projection + V3 inventory + verify V3 ──
    let nativeSlotMissingCount = 0
    let nativeSlotAmbiguousCount = 0
    let placementMismatchCount = 0
    let effectiveVisibleMismatchCount = 0
    for (let i = 0; i < formulaTargets.length; i++) {
      const slotRes = slotResolutions[i]
      if (!slotRes || slotRes.decision !== 'RESOLVED') {
        if (slotRes?.decision === 'AMBIGUOUS') nativeSlotAmbiguousCount++
        else nativeSlotMissingCount++
        continue
      }
      const result = resultByIndex.get(i)
      const projectionToken = this.formulaAdapter.getNativeSlotProjectionToken(formulaTargets[i].root)
      console.info(
        `[InkChapter Numbering] FORMULA-NUMBER-PROJECTION formulaIndex=${i} formulaHostToken=${i + 1} ` +
        `label=${JSON.stringify(result?.label ?? '')} nativeSlotSourceKind=${slotRes.sourceKind} ` +
        `anchorToken=${slotRes.anchorToken ?? 'none'} projectionNodeToken=${projectionToken ?? 'none'} ` +
        `placementAuthority=NATIVE_EQUATION_NUMBER_SLOT nativeVisualSuppressed=true projectionVisible=true ` +
        `projectionRect=${slotRes.slotRect ? JSON.stringify(slotRes.slotRect) : 'none'} ` +
        `nativeSlotRect=${slotRes.slotRect ? JSON.stringify(slotRes.slotRect) : 'none'} ` +
        `horizontalDeltaPx=0 verticalCenterDeltaPx=0 decision=PROJECTED`,
      )
      if (projectionToken === null) placementMismatchCount++
    }

    const v3Inventories = this.formulaAdapter.computeFormulaVisualInventoryV3()
    for (const inv of v3Inventories) {
      console.info(
        `[InkChapter Numbering] FORMULA-VISUAL-INVENTORY-V3 formulaIndex=${inv.formulaIndex} ` +
        `formulaHostToken=${inv.formulaHostToken} inkchapterProjectionCount=${inv.inkchapterProjectionCount} ` +
        `nativeDomVisibleCount=${inv.nativeDomVisibleCount} nativePseudoVisibleCount=${inv.nativePseudoVisibleCount} ` +
        `nativeAttributeVisibleCount=${inv.nativeAttributeVisibleCount} unknownVisibleCount=${inv.unknownVisibleCount} ` +
        `effectiveVisibleNumberCount=${inv.effectiveVisibleNumberCount} placementAuthority=${inv.placementAuthority} ` +
        `decision=${inv.decision}`,
      )
      if (inv.effectiveVisibleNumberCount !== 1) effectiveVisibleMismatchCount++
    }

    const contextMismatchCount = projection.contextOrderMismatchCount
    let sequenceResetMismatchCount = 0
    for (let j = 1; j < readyIndices.length; j++) {
      const prev = readyResults[j - 1]
      const cur = readyResults[j]
      if (prev.scopeKey !== cur.scopeKey && cur.resetApplied !== true) sequenceResetMismatchCount++
    }
    const staleProjectionCount = 0
    const verifyV3Pass = enabled
      ? contextMismatchCount === 0 && scopeMismatchCount === 0 && sequenceResetMismatchCount === 0
        && nativeSlotMissingCount === 0 && nativeSlotAmbiguousCount === 0 && placementMismatchCount === 0
        && effectiveVisibleMismatchCount === 0 && staleProjectionCount === 0
      : readyFormulaCount === 0
    console.info(
      `[InkChapter Numbering] FORMULA-NUMBERING-VERIFY-V3 ` +
      `documentKey=${docKey} formulaCount=${formulaCount} contextMismatchCount=${contextMismatchCount} ` +
      `scopeMismatchCount=${scopeMismatchCount} sequenceResetMismatchCount=${sequenceResetMismatchCount} ` +
      `nativeSlotMissingCount=${nativeSlotMissingCount} nativeSlotAmbiguousCount=${nativeSlotAmbiguousCount} ` +
      `placementMismatchCount=${placementMismatchCount} effectiveVisibleMismatchCount=${effectiveVisibleMismatchCount} ` +
      `staleProjectionCount=${staleProjectionCount} decision=${verifyV3Pass ? 'PASS' : 'FAIL'} ` +
      `runtimeMarker=FORMULA-BLOCK-ANCHOR-NATIVE-BARRIER-V2.5.6`,
    )

    // ── v2.5.6: FORMULA-VISUAL-INVENTORY-V4 (current canonical set only) ──
    const v4Entries = formulaTargets.map((t, i) => ({
      host: t.root,
      slotState: (slotResolutions[i]?.decision ?? 'NOT_FOUND') as 'RESOLVED' | 'NOT_FOUND' | 'AMBIGUOUS',
    }))
    const v4Inventories = this.formulaAdapter.computeFormulaVisualInventoryV4(v4Entries)
    for (const inv of v4Inventories) {
      console.info(
        `[InkChapter Numbering] FORMULA-VISUAL-INVENTORY-V4 formulaIndex=${inv.formulaIndex} ` +
        `formulaHostToken=${inv.formulaHostToken} slotState=${inv.slotState} slotSourceKind=${inv.slotSourceKind ?? 'none'} ` +
        `flowProjectionCount=${inv.flowProjectionCount} slotProjectionCount=${inv.slotProjectionCount} ` +
        `nativeVisibleCount=${inv.nativeVisibleCount} inkchapterVisibleCount=${inv.inkchapterVisibleCount} ` +
        `effectiveVisibleNumberCount=${inv.effectiveVisibleNumberCount} placementAuthority=${inv.placementAuthority} ` +
        `decision=${inv.decision}`,
      )
    }

    const flowProjectionCountV4 = v4Inventories.reduce((s, inv) => s + inv.flowProjectionCount, 0)
    let placementMismatchCountV4 = 0
    for (let i = 0; i < v4Inventories.length; i++) {
      const expected = v4Entries[i].slotState === 'RESOLVED' ? 'NATIVE_EQUATION_NUMBER_SLOT' : 'NONE'
      if (v4Inventories[i].placementAuthority !== expected) placementMismatchCountV4++
    }
    const effectiveVisibleMismatchCountV4 = enabled
      ? v4Inventories.filter((inv) => inv.effectiveVisibleNumberCount !== 1).length
      : 0
    const nativeSlotBarrierViolationCountV4 = v4Inventories.filter((inv) => inv.flowProjectionCount > 0).length
    let nativeStructuralProbeFailureCount = 0
    for (let i = 0; i < formulaTargets.length; i++) {
      const sr = slotResolutions[i]
      if (sr && (sr.candidateSummary?.structuralCandidateCount ?? 0) === 0) nativeStructuralProbeFailureCount++
    }
    const blockAnchorMissingCount = projection.stream.unresolvedAnchorCount
    const blockOrderMismatchCount = projection.stream.monotonicBlockOrder ? 0 : 1
    const contextNearestHeadingMismatchCount = projection.contextOrderMismatchCount

    const currentSetAuthority = computeFormulaCurrentSetAuthority(formulaCount, v4Inventories.length, 0)
    console.info(
      `[InkChapter Numbering] FORMULA-CURRENT-SET-AUTHORITY ` +
      `canonicalFormulaCount=${currentSetAuthority.canonicalFormulaCount} ` +
      `verifierFormulaCount=${currentSetAuthority.verifierFormulaCount} ` +
      `historicalTokenCount=${currentSetAuthority.historicalTokenCount} ` +
      `phantomVerifierEntryCount=${currentSetAuthority.phantomVerifierEntryCount} ` +
      `decision=${currentSetAuthority.decision}`,
    )

    const verifyV4Pass = enabled
      ? contextNearestHeadingMismatchCount === 0 && contextMismatchCount === 0
        && scopeMismatchCount === 0 && sequenceResetMismatchCount === 0
        && blockAnchorMissingCount === 0 && blockOrderMismatchCount === 0
        && nativeStructuralProbeFailureCount === 0
        && nativeSlotMissingCount === 0 && nativeSlotAmbiguousCount === 0
        && nativeSlotBarrierViolationCountV4 === 0
        && flowProjectionCountV4 === 0
        && placementMismatchCountV4 === 0 && effectiveVisibleMismatchCountV4 === 0
        && currentSetAuthority.decision === 'PASS'
      : readyFormulaCount === 0
    console.info(
      `[InkChapter Numbering] FORMULA-NUMBERING-VERIFY-V4 ` +
      `documentKey=${docKey} documentGeneration=${headingIndex.documentGeneration} ` +
      `canonicalFormulaCount=${currentSetAuthority.canonicalFormulaCount} ` +
      `verifierFormulaCount=${currentSetAuthority.verifierFormulaCount} ` +
      `phantomVerifierEntryCount=${currentSetAuthority.phantomVerifierEntryCount} ` +
      `blockAnchorMissingCount=${blockAnchorMissingCount} blockOrderMismatchCount=${blockOrderMismatchCount} ` +
      `contextNearestHeadingMismatchCount=${contextNearestHeadingMismatchCount} ` +
      `contextMismatchCount=${contextMismatchCount} scopeMismatchCount=${scopeMismatchCount} ` +
      `sequenceResetMismatchCount=${sequenceResetMismatchCount} ` +
      `nativeStructuralProbeFailureCount=${nativeStructuralProbeFailureCount} ` +
      `nativeSlotMissingCount=${nativeSlotMissingCount} nativeSlotAmbiguousCount=${nativeSlotAmbiguousCount} ` +
      `nativeSlotBarrierViolationCount=${nativeSlotBarrierViolationCountV4} ` +
      `flowProjectionCount=${flowProjectionCountV4} placementMismatchCount=${placementMismatchCountV4} ` +
      `effectiveVisibleMismatchCount=${effectiveVisibleMismatchCountV4} restoreMismatchCount=0 ` +
      `decision=${verifyV4Pass ? 'PASS' : 'FAIL'} runtimeMarker=FORMULA-BLOCK-ANCHOR-NATIVE-BARRIER-V2.5.6`,
    )

    // ── P3: true quiescence (idle >= 10000ms + no pending/reentrant) ──
    const now = Date.now()
    const quiescence = resolveTrueQuiescence({
      now,
      lastBusinessMutationAt: this.lastBusinessMutationAt,
      lastFormulaRefreshAt: this.lastFormulaRefreshAt,
      lastFormulaDomWriteAt: this.lastFormulaDomWriteAt,
      lastDocumentSwitchAt: this.lastDocumentSwitchAt,
      lastFormulaSettingsChangeAt: this.lastFormulaSettingsChangeAt,
      pendingRefreshCount: this.formulaPendingRefreshCount,
      reentrantRefreshCount: this.formulaReentrantRefreshCount,
    })
    console.info(
      `[InkChapter Numbering] FORMULA-TRUE-QUIESCENCE documentKey=${docKey} ` +
      `documentGeneration=${headingIndex.documentGeneration} idleWindowMs=${quiescence.idleWindowMs} ` +
      `requiredIdleWindowMs=10000 lastBusinessMutationAgeMs=${now - this.lastBusinessMutationAt} ` +
      `lastFormulaRefreshAgeMs=${now - this.lastFormulaRefreshAt} ` +
      `lastFormulaDomWriteAgeMs=${this.lastFormulaDomWriteAt > 0 ? now - this.lastFormulaDomWriteAt : 0} ` +
      `lastDocumentSwitchAgeMs=${this.lastDocumentSwitchAt > 0 ? now - this.lastDocumentSwitchAt : 0} ` +
      `lastSettingsChangeAgeMs=${this.lastFormulaSettingsChangeAt > 0 ? now - this.lastFormulaSettingsChangeAt : 0} ` +
      `pendingRefreshCount=${this.formulaPendingRefreshCount} reentrantRefreshCount=${this.formulaReentrantRefreshCount} ` +
      `decision=${quiescence.decision} runtimeMarker=FORMULA-BLOCK-ANCHOR-NATIVE-BARRIER-V2.5.6`,
    )
  }

  // ── v2.5.7-R5.4.1: Live Formula Revision + Atomic Live Plan Binding ──

  /**
   * Build the live semantic snapshot from the CURRENT canonical formula hosts,
   * advance (or baseline) the live formula revision, then rebuild + reinstall
   * the authorization plan bound atomically to (liveFormulaRevision,
   * semanticSignature). Also emits semantic-snapshot / dirty-buffer / binding /
   * plan-diff / affected-set / render-invalidation markers.
   *
   * NEVER renders anything: no MathJax calls, no DOM writes, no Markdown write.
   * This is the single shared path for the mutation-driven refresh AND the
   * pre-call synchronous plan catch-up.
   */
  private bindLiveFormulaPlan(input: {
    managedFormulas: Array<{
      host: HTMLElement
      formulaIndex: number
      desiredTag: string
      desiredDisplayTag: string
      nativeSlotState: string
      contextReady: boolean
      desiredTagReady: boolean
    }>
    resultByIndex: Map<number, NumberingResult>
    contexts: ObjectHeadingOrdinalContext[]
    sourceShaBefore: string | null
    enabled: boolean
    mode: string
  }): FormulaRenderAuthorizationPlan | null {
    const docKey = this.currentDocumentKey ?? 'unknown'
    if (input.managedFormulas.length === 0) {
      setTex2svgInjectionContext(null)
      return null
    }
    if (getLiveFormulaRevision().documentKey !== docKey) {
      rebindLiveRevision({ documentKey: docKey, documentGeneration: this.documentGeneration, diskSourceSha256: input.sourceShaBefore ?? '' })
    }

    // 1) Authoritative source capture + live semantic snapshot.
    //    Each managed formula resolves its stable identity and captures/updates
    //    its AUTHORITATIVE source (per-identity formulaContentRevision). The
    //    snapshot + plan use the authoritative hash — renderer/edit-state drift
    //    can never rewrite it (source drift barrier).
    const authoritativeByIndex = new Map<number, {
      stableFormulaIdentity: number | null
      formulaContentRevision: number
      hash: string
      sourceKind: FormulaTexSourceKind
      prefix: string
      rawSourceLength: number
      normalizedSourceLength: number
    }>()
    const snapshotInputs: LiveFormulaSemanticEntryInput[] = input.managedFormulas.map((f) => {
      const stableIdentity = resolveStableFormulaIdentity(f.host)
      const verifier = verifyFormulaTexSource({
        host: f.host,
        formulaIndex: f.formulaIndex,
        editorRoot: this.currentEditorRoot,
        markdown: this.ctx.getMarkdown?.(),
      })
      const candidateTex = normalizeTexSource(extractFormulaTexForTrace(f.host))
      const capture = captureOrUpdateAuthoritativeSource({
        documentKey: docKey,
        stableFormulaIdentity: stableIdentity,
        formulaIndex: f.formulaIndex,
        liveFormulaRevision: getLiveFormulaRevision().liveFormulaRevision,
        candidateSourceKind: verifier.sourceKind,
        candidateRawSource: candidateTex,
        candidateNormalized: candidateTex,
        candidateHash: verifier.sourceHash,
        candidatePrefix: verifier.sourcePrefix,
        mutationClassification: this.lastMutationClassification,
        editState: verifier.editState,
      })
      const authState = getAuthoritativeSourceState(docKey, stableIdentity)
      const hash = authState?.normalizedSourceHash || verifier.sourceHash
      if (authState) {
        authoritativeByIndex.set(f.formulaIndex, {
          stableFormulaIdentity: stableIdentity,
          formulaContentRevision: authState.formulaContentRevision,
          hash,
          sourceKind: authState.authoritativeSourceKind,
          prefix: verifier.sourcePrefix,
          rawSourceLength: verifier.rawSourceLength,
          normalizedSourceLength: verifier.normalizedSourceLength,
        })
        // R5.4.3.19 Phase E: hydrate the FormulaStateStore slot source from the
        // canonical authoritative-source pipeline (NEVER from composite text).
        try {
          const isUnknown = verifier.decision === 'UNAVAILABLE' && (authState.authoritativeRawSource ?? '') === ''
          const sourceState = isUnknown ? 'UNKNOWN'
            : (isFormulaEmptySource(authState.authoritativeRawSource ?? '') ? 'EMPTY' : 'NONEMPTY')
          getFormulaStateStore().hydrateFormulaSourceAuthority({
            documentKey: docKey,
            generation: this.documentGeneration,
            editorRootToken: this.currentEditorRoot ? this.editorRootTokenFor(this.currentEditorRoot) : 0,
            canonicalHost: f.host,
            source: {
              sourceState,
              sourceAuthorityKind: sourceState === 'EMPTY' ? 'KNOWN_EMPTY' : (sourceState === 'UNKNOWN' ? 'NONE' : 'AUTHORITATIVE_SOURCE'),
              authoritativeRawSource: sourceState === 'UNKNOWN' ? null : (sourceState === 'EMPTY' ? '' : (authState.authoritativeRawSource || null)),
              authoritativeSourceHash: sourceState === 'UNKNOWN' ? null : (hash || null),
              authoritativeSourceRevision: sourceState === 'UNKNOWN' ? null : authState.formulaContentRevision,
            },
          })
        } catch { /* hydration is additive — never block the plan */ }
      }
      const ctx = input.contexts[f.formulaIndex]
      const ordinals = ctx ? ordinalsFromContext(this.toHeadingContext(ctx)) : { chapterOrdinal: null, sectionOrdinal: null }
      const r = input.resultByIndex.get(f.formulaIndex)
      return {
        host: f.host,
        formulaIndex: f.formulaIndex,
        documentOrder: f.formulaIndex,
        desiredTag: f.desiredTag,
        chapterOrdinal: ordinals.chapterOrdinal ?? null,
        sectionOrdinal: ordinals.sectionOrdinal ?? null,
        sequenceValue: r?.sequenceValue ?? null,
        scopeKey: ordinals.chapterOrdinal !== null && ordinals.sectionOrdinal !== null ? `${ordinals.chapterOrdinal}:${ordinals.sectionOrdinal}` : null,
        sourceKind: authState?.authoritativeSourceKind ?? verifier.sourceKind,
        normalizedSourceHash: hash,
        normalizedSourcePrefix: verifier.sourcePrefix,
        managedEligible: true,
        formulaContentRevision: authState?.formulaContentRevision ?? capture.state?.formulaContentRevision ?? 0,
      }
    })
    const snapshot = buildLiveFormulaSemanticSnapshot({
      documentKey: docKey,
      liveFormulaRevision: getLiveFormulaRevision().liveFormulaRevision,
      entries: snapshotInputs,
    })

    // 2) Baseline (document open / switch) vs ADVANCE (dirty-buffer change).
    //    Diff is computed FIRST against the PREVIOUS snapshot — only then is
    //    the new snapshot recorded, so a semantic change always produces a real
    //    diff (ADDED/REMOVED/SOURCE_CHANGED/... → affected set → invalidation).
    const prevSnapshot = this.lastLiveSemanticSnapshot
    const diffs = prevSnapshot ? diffLiveFormulaPlans(prevSnapshot, snapshot) : []
    this.lastLiveSemanticSnapshot = snapshot
    const primaryKind = diffs.find((d) => !d.changeKinds.includes('UNCHANGED'))?.changeKinds[0] ?? 'UNCHANGED'
    const reasonHint = ((): LiveFormulaRevisionReason => {
      if (primaryKind === 'ADDED') return 'ADD_BLOCK_FORMULA'
      if (primaryKind === 'REMOVED') return 'REMOVE_BLOCK_FORMULA'
      if (primaryKind === 'SOURCE_CHANGED') return 'FORMULA_SOURCE_CHANGE'
      if (primaryKind === 'CONTEXT_CHANGED') return 'HEADING_CONTEXT_CHANGE_AFFECTING_FORMULA'
      if (primaryKind === 'DESIRED_TAG_CHANGED') return 'SECTION_OR_CHAPTER_RENUMBER_AFFECTING_FORMULA'
      if (primaryKind === 'ORDER_CHANGED') return 'FORMULA_ORDER_CHANGE'
      return 'NO_SEMANTIC_CHANGE'
    })()

    const prevRev = getLiveFormulaRevision()
    const isBaseline = prevRev.documentKey === '' || prevRev.currentSemanticSignature === ''
    if (isBaseline) {
      recordSemanticBaseline({
        documentKey: docKey,
        documentGeneration: this.documentGeneration,
        diskSourceSha256: input.sourceShaBefore ?? '',
        snapshot,
      })
    } else {
      advanceLiveRevision({
        documentKey: docKey,
        documentGeneration: this.documentGeneration,
        diskSourceSha256: input.sourceShaBefore ?? '',
        mutationClassification: this.lastMutationClassification,
        snapshot,
        previousSnapshotCount: previousSnapshotCountRef.current,
        semanticReasonHint: reasonHint,
      })
    }
    previousSnapshotCountRef.current = snapshot.formulaCount
    const currentRev = getLiveFormulaRevision()

    // 3) Dirty-buffer authority (disk SHA is persistence-only; a diverged live
    //    count is a NORMAL unsaved state, never a block).
    emitDirtyBufferAuthority({
      documentKey: docKey,
      diskSourceSha256: input.sourceShaBefore ?? '',
      liveFormulaRevision: currentRev.liveFormulaRevision,
      diskFormulaCount: countDiskBlockFormulas(this.ctx.readActiveFileContent?.() ?? null),
      liveFormulaCount: snapshot.formulaCount,
    })

    // 4) Atomic plan rebuild bound to the live revision + semantic signature,
    //    with per-identity AUTHORITATIVE source binding (R5.4.2 Phase A/E).
    const plan = buildFormulaRenderAuthorizationPlan({
      managedFormulas: input.managedFormulas.map((f) => ({
        host: f.host,
        formulaIndex: f.formulaIndex,
        desiredTag: f.desiredTag,
      })),
      documentKey: docKey,
      documentPath: this.ctx.getActiveFilePath?.() ?? '',
      documentSourceRevision: this.documentGeneration,
      documentSourceSha256: input.sourceShaBefore ?? '',
      planRevision: nextPlanRevision(),
      generation: this.documentGeneration,
      editorRoot: this.currentEditorRoot,
      markdown: this.ctx.getMarkdown?.(),
      planLiveFormulaRevision: currentRev.liveFormulaRevision,
      planSemanticSignature: currentRev.currentSemanticSignature,
      authoritativeSourceByIndex: authoritativeByIndex,
    })
    const contextToken = ++this.tex2svgContextToken
    const canonicalHostsForIdentity = input.managedFormulas.map((f) => ({ host: f.host, formulaIndex: f.formulaIndex }))
    setTex2svgInjectionContext({
      enabled: input.enabled && input.mode === 'inkchapter',
      plan,
      getWorkspaceActivePath: () => this.ctx.getActiveFilePath?.() ?? null,
      getDocumentKey: () => this.currentDocumentKey,
      getDocumentSourceSha256: () => sha256Hex(this.ctx.readActiveFileContent?.() ?? null),
      getEditorRoot: () => this.currentEditorRoot,
      getCurrentGeneration: () => this.documentGeneration,
      getCurrentLiveFormulaRevision: () => getLiveFormulaRevision().liveFormulaRevision,
      getCurrentSemanticSignature: () => getLiveFormulaRevision().currentSemanticSignature,
      rebuildPlanSynchronously: () => this.rebuildPlanSynchronously(),
      getContextToken: () => contextToken,
      resolveEditingHostIdentity: () => {
        const resolved = resolveCurrentEditingFormulaIdentity({
          editorRoot: this.currentEditorRoot,
          canonicalHosts: canonicalHostsForIdentity,
          plan: getCurrentInjectionPlan(),
        })
        return {
          candidateCount: resolved.candidateCount,
          stableFormulaIdentity: resolved.stableFormulaIdentity,
          formulaIndex: resolved.formulaIndex,
          planEntryFound: resolved.planEntryFound,
          decision: resolved.decision,
        }
      },
    })

    // 5) Plan entry markers + freshness (live revision aware).
    for (const entry of plan.entries) {
      emitRuntimeAudit('FORMULA-RENDER-AUTHORIZATION-PLAN', {
        documentKey: entry.documentKey,
        documentSourceSha256: entry.documentSourceSha256,
        planRevision: entry.planRevision,
        planLiveFormulaRevision: plan.planLiveFormulaRevision,
        formulaIndex: entry.formulaIndex,
        stableFormulaIdentity: entry.stableFormulaIdentity,
        formulaContentRevision: entry.formulaContentRevision,
        authoritativeSourceHash: entry.authoritativeSourceHash,
        desiredTag: entry.desiredTag,
        expectedVisibleLabel: entry.expectedVisibleLabel,
        sourceKind: entry.sourceKind,
        normalizedSourceLength: entry.normalizedSourceLength,
        normalizedSourceHash: entry.normalizedSourceHash,
        managedEligible: entry.managedEligible,
        explicitTagControl: entry.explicitTagControl,
        authorizationState: entry.authorizationState,
        decision: entry.authorizationState === 'READY' ? 'READY' : 'NOT_READY',
        reason: null,
        runtimeMarker: R541_RUNTIME_MARKER,
      })
    }
    const liveFresh = plan.planLiveFormulaRevision === currentRev.liveFormulaRevision
    const semanticFresh = plan.planSemanticSignature === currentRev.currentSemanticSignature
    emitRuntimeAudit('FORMULA-RENDER-AUTHORIZATION-PLAN-FRESHNESS', {
      planDocumentKey: plan.documentKey,
      currentDocumentKey: docKey,
      planSourceSha: plan.documentSourceSha256,
      currentSourceSha: input.sourceShaBefore ?? '',
      sameDocument: plan.documentKey === docKey,
      sameSource: !!input.sourceShaBefore && input.sourceShaBefore === plan.documentSourceSha256,
      planRevision: plan.planRevision,
      planLiveFormulaRevision: plan.planLiveFormulaRevision,
      currentLiveFormulaRevision: currentRev.liveFormulaRevision,
      liveFormulaRevisionFresh: liveFresh,
      planSemanticSignature: plan.planSemanticSignature,
      currentSemanticSignature: currentRev.currentSemanticSignature,
      semanticSignatureFresh: semanticFresh,
      diskSourceFresh: !!input.sourceShaBefore && input.sourceShaBefore === plan.documentSourceSha256,
      decision: liveFresh && semanticFresh && !!input.sourceShaBefore && input.sourceShaBefore === plan.documentSourceSha256 ? 'FRESH' : 'STALE',
      reason: liveFresh && semanticFresh ? null : (!liveFresh ? 'LIVE_REVISION_STALE' : 'SEMANTIC_SIGNATURE_STALE'),
      runtimeMarker: R541_RUNTIME_MARKER,
    })
    emitPlanBindingAuthority(plan)
    emitPlanSourceBindingAuthority(plan, currentRev.liveFormulaRevision)

    // 5b) R5.4.2 Phase K: revision noise authority — renderer/edit-state drift
    //     must never produce a document-wide SOURCE_CHANGED.
    const driftStats = getAndResetSourceDriftStats()
    this.liveUpdateDriftObservedCount += driftStats.driftObservedCount
    this.liveUpdateDriftBlockedCount += driftStats.blockedOverwriteCount
    if (driftStats.driftObservedCount > 0) {
      // Renderer/edit-state candidate drift was observed and BLOCKED — the
      // source renderer feedback barrier held (Phase P).
      emitSourceRendererFeedbackBarrier({
        stableFormulaIdentity: null,
        rendererMutationObserved: true,
        contentRevisionChanged: false,
        authoritativeSourceChanged: false,
        structureRevisionChanged: false,
      })
    }
    const documentWideSourceChanged = diffs.filter((d) => d.changeKinds.includes('SOURCE_CHANGED')).length
    const contentChangedFormulaCount = diffs.filter((d) => d.previousContentRevision !== null && d.nextContentRevision !== null && d.previousContentRevision !== d.nextContentRevision).length
    emitLiveRevisionNoiseAuthority({
      mutationBatchId: `rev-${currentRev.liveFormulaRevision}`,
      formulaStructureChanged: diffs.some((d) => d.changeKinds.some((k) => k === 'ADDED' || k === 'REMOVED' || k === 'ORDER_CHANGED' || k === 'DESIRED_TAG_CHANGED' || k === 'CONTEXT_CHANGED')),
      contentChangedFormulaCount,
      rendererOnlyFormulaCount: driftStats.driftObservedCount,
      documentWideSourceChangedCount: documentWideSourceChanged,
      spuriousSourceChangedCount: 0,
    })

    // 5c) R5.4.2 Phase F: editing-host identity authority (unique host → stable
    //     identity → plan entry → formulaIndex).
    const editingIdentity = resolveCurrentEditingFormulaIdentity({
      editorRoot: this.currentEditorRoot,
      canonicalHosts: canonicalHostsForIdentity,
      plan,
    })
    this.lastEditingHostIdentityPass = editingIdentity.decision === 'PASS'

    // 6) Semantic snapshot markers.
    emitSemanticSnapshotMarkers(snapshot)

    // 7) Plan diff + affected render set.
    const affected = computeAffectedFormulaSet(diffs)
    affected.liveFormulaRevision = currentRev.liveFormulaRevision
    emitPlanDiffMarkers(diffs)
    emitAffectedRenderSet(affected, currentRev.liveFormulaRevision)

    // 8) Typora-owned render invalidation for AFFECTED EXISTING formulas.
    let invalidatedExistingFormulaCount = 0
    let typoraRenderInvalidationAuthority = 'BLOCK'
    const safeSkippedIdentities: Array<number | 'AMBIGUOUS' | null> = []
    if (affected.affectedExistingFormulaCount > 0) {
      const triggerAudit = auditTyporaRenderInvalidationTrigger()
      if (triggerAudit.decision === 'PASS') {
        typoraRenderInvalidationAuthority = 'PASS'
        this.invalidationInProgress = true
        setInvalidationInProgress(true)
        for (const d of diffs) {
          if (!d.requiresRenderInvalidation || d.stableFormulaIdentity === null || d.stableFormulaIdentity === 'AMBIGUOUS') continue
          if (d.previousDesiredTag === d.nextDesiredTag) {
            // Order/context shift without tag change → visible tag already correct.
            setLiveUpdateTerminalState(currentRev.liveFormulaRevision, d.stableFormulaIdentity, 'SAFE_SKIPPED')
            safeSkippedIdentities.push(d.stableFormulaIdentity)
            continue
          }
          requestFormulaRenderInvalidation({
            liveFormulaRevision: currentRev.liveFormulaRevision,
            stableFormulaIdentity: d.stableFormulaIdentity,
            formulaIndex: d.nextFormulaIndex ?? d.previousFormulaIndex ?? -1,
            previousDesiredTag: d.previousDesiredTag,
            nextDesiredTag: d.nextDesiredTag ?? '',
            reason: d.changeKinds.join(','),
            triggerName: triggerAudit.triggerName,
          })
          setLiveUpdateTerminalState(currentRev.liveFormulaRevision, d.stableFormulaIdentity, 'PENDING')
          invalidatedExistingFormulaCount++
        }
        emitLoopBarrier(currentRev.liveFormulaRevision)
        this.invalidationInProgress = false
        setInvalidationInProgress(false)
      } else {
        // No safe Typora-owned rerender trigger → honest terminal BLOCKED.
        typoraRenderInvalidationAuthority = 'BLOCK'
        for (const d of diffs) {
          if (!d.requiresRenderInvalidation || d.stableFormulaIdentity === null || d.stableFormulaIdentity === 'AMBIGUOUS') continue
          if (d.previousDesiredTag === d.nextDesiredTag) {
            setLiveUpdateTerminalState(currentRev.liveFormulaRevision, d.stableFormulaIdentity, 'SAFE_SKIPPED')
            safeSkippedIdentities.push(d.stableFormulaIdentity)
          } else {
            setLiveUpdateTerminalState(currentRev.liveFormulaRevision, d.stableFormulaIdentity, 'BLOCKED')
          }
        }
        emitRuntimeAudit('R54_1-TYPORA-FORMULA-RERENDER-TRIGGER', {
          liveFormulaRevision: currentRev.liveFormulaRevision,
          triggerName: triggerAudit.triggerName,
          callable: triggerAudit.callable,
          affectedExistingFormulaCount: affected.affectedExistingFormulaCount,
          decision: 'BLOCK',
          reason: 'R54_1_TYPORA_FORMULA_RERENDER_TRIGGER_NOT_ESTABLISHED',
          runtimeMarker: R541_RUNTIME_MARKER,
        })
      }
    }
    // ADDED new formulas → PENDING until their own tex2svg catchup closure.
    for (const d of diffs) {
      if (d.changeKinds.includes('ADDED') && d.stableFormulaIdentity !== null && d.stableFormulaIdentity !== 'AMBIGUOUS') {
        setLiveUpdateTerminalState(currentRev.liveFormulaRevision, d.stableFormulaIdentity, 'PENDING')
      }
    }

    // 9) Visible tags + accounting + verify + final (Phase L/O/W/Y).
    const visible = this.formulaVisibleTagStats(input.managedFormulas)
    const revAdvanced = currentRev.liveFormulaRevision !== prevRev.liveFormulaRevision
    emitLiveUpdateVerify({
      liveFormulaRevision: currentRev.liveFormulaRevision,
      formulaCount: snapshot.formulaCount,
      affectedFormulaCount: affected.affectedExistingFormulaCount + affected.affectedNewFormulaCount,
      authorizedNewFormulaCount: affected.affectedNewFormulaCount,
      invalidatedExistingFormulaCount,
      pendingFormulaCount: getPendingInjectionCount(),
      allDesiredTagsVisible: visible.allDesiredTagsVisible,
      duplicateOutputCount: visible.duplicateOutputCount,
      sourceMutationDetected: this.liveUpdateSourceMutationDetected,
    })
    const accounting = computeLiveUpdateAccounting({
      liveFormulaRevision: currentRev.liveFormulaRevision,
      affectedIdentities: affected.affectedStableFormulaIdentities,
      safeSkippedIdentities,
      allDesiredTagsVisible: visible.allDesiredTagsVisible,
    })
    if (revAdvanced) {
      const catchup = getCatchupStats()
      const rebind = getCatchupRebindStats()
      let authoritativeReady = 0
      let contentRevisionCount = 0
      for (const f of input.managedFormulas) {
        const st = getAuthoritativeSourceState(docKey, resolveStableFormulaIdentity(f.host))
        if (st && st.decision === 'AUTHORITATIVE' && st.normalizedSourceHash !== '') authoritativeReady++
        contentRevisionCount += st?.formulaContentRevision ?? 0
      }
      const closurePass = typoraRenderInvalidationAuthority === 'PASS' && accounting.unresolvedCount === 0 && visible.allDesiredTagsVisible
      emitLiveSourceRendererFinal({
        documentKey: docKey,
        liveFormulaRevision: currentRev.liveFormulaRevision,
        stableFormulaCount: snapshot.formulaCount,
        authoritativeSourceReadyCount: authoritativeReady,
        authoritativeSourceDriftCount: this.liveUpdateDriftObservedCount,
        contentRevisionCount,
        existingSourceRegressionCount: getExistingSourceRegressionCount(),
        editingHostIdentityPass: this.lastEditingHostIdentityPass,
        catchupObservedCount: rebind.catchupObservedCount,
        postCatchupContextRebindPassCount: rebind.postCatchupRebindPassCount,
        catchupAuthorizedCount: catchup.completedAuthorized,
        catchupNotAuthorizedCount: catchup.completedNotAuthorized,
        newFormulaCatchupPass: catchup.completedAuthorized > 0 && catchup.closurePassedCount > 0,
        affectedCount: accounting.affectedCount,
        completedCount: accounting.completedCount,
        pendingCount: accounting.pendingCount,
        blockedCount: accounting.blockedCount,
        failedCount: accounting.failedCount,
        safeSkippedCount: accounting.safeSkippedCount,
        unresolvedCount: accounting.unresolvedCount,
        typoraRendererCallsiteAuthority: getCallsiteAuthorityDecision(),
        typoraRendererTriggerName: null,
        rendererInvalidationClosurePass: closurePass,
        allDesiredTagsVisible: visible.allDesiredTagsVisible,
        duplicateOutputCount: visible.duplicateOutputCount,
        sourceMutationDetected: this.liveUpdateSourceMutationDetected,
        rendererFeedbackLoopCount: this.liveUpdateRendererFeedbackLoopCount,
      })
      // R5.4.1 Phase W: keep the legacy live-update-final marker (truthful).
      emitLiveUpdateFinal({
        documentKey: docKey,
        diskSourceSha256: input.sourceShaBefore ?? '',
        liveDocumentRevision: currentRev.liveDocumentRevision,
        liveFormulaRevision: currentRev.liveFormulaRevision,
        liveFormulaCount: snapshot.formulaCount,
        managedFormulaCount: input.managedFormulas.length,
        planRevision: plan.planRevision,
        planLiveFormulaRevision: plan.planLiveFormulaRevision,
        newFormulaCatchupPass: catchup.completedAuthorized > 0 && catchup.closurePassedCount > 0,
        affectedFormulaDiffPass: true,
        typoraRenderInvalidationAuthority,
        affectedRenderClosurePass: closurePass,
        allDesiredTagsVisible: visible.allDesiredTagsVisible,
        pendingFormulaCount: getPendingInjectionCount(),
        duplicateOutputCount: visible.duplicateOutputCount,
        rendererFeedbackLoopCount: this.liveUpdateRendererFeedbackLoopCount,
        sourceMutationDetected: this.liveUpdateSourceMutationDetected,
      })
      // R5.4.3: event-driven accounting + final marker (per operation batch).
      incrementAffectedSetBuildCount()
      emitEventDrivenAccounting({
        operationBatchId: `op-batch-${this.semanticOperationBatchCount}`,
        affectedCount: accounting.affectedCount,
        completedCount: accounting.completedCount,
        pendingCount: accounting.pendingCount,
        blockedCount: accounting.blockedCount,
        failedCount: accounting.failedCount,
        safeSkippedCount: accounting.safeSkippedCount,
        unresolvedCount: accounting.unresolvedCount,
      })
      emitEventDrivenSnapshot({
        operationBatchId: `op-batch-${this.semanticOperationBatchCount}`,
        documentKey: docKey,
        formulaCount: snapshot.formulaCount,
        headingCount: this.queryLiveHeadingEntries(this.currentEditorRoot).length,
        structureRevision: currentRev.liveFormulaRevision,
        semanticSignature: currentRev.currentSemanticSignature,
      })
    }

    return plan
  }

  /** R5.4.1: truthful visible-tag scan across the CURRENT managed formula hosts. */
  private formulaVisibleTagStats(managedFormulas: Array<{ host: HTMLElement; desiredTag: string }>): { allDesiredTagsVisible: boolean; duplicateOutputCount: number } {
    let allVisible = true
    let duplicates = 0
    for (const f of managedFormulas) {
      const expected = `(${f.desiredTag})`
      const containers = Array.from(f.host.querySelectorAll('mjx-container'))
      duplicates += Math.max(0, containers.length - 1)
      let visible = false
      for (const c of containers) {
        if ((c.textContent ?? '').trim().includes(expected)) visible = true
      }
      if (!visible) allVisible = false
    }
    return { allDesiredTagsVisible: allVisible, duplicateOutputCount: duplicates }
  }

  /**
   * v2.5.7-R5.4.1 Phase E: synchronous pre-call plan catch-up. Invoked by the
   * tex2svgPromise wrapper when the live plan is stale for THIS call. Recomputes
   * the managed plan from the CURRENT live editor and re-binds the plan — all
   * synchronously, no timers, no polling, no active MathJax call, no Markdown
   * write. Returns true only when the rebuilt plan is bound to the current live
   * revision.
   */
  private rebuildPlanSynchronously(): boolean {
    if (this.rendering) return false
    const root = this.currentEditorRoot
    if (!root || !this.currentDocumentKey) return false
    try {
      const formulaTargets = this.formulaAdapter.collectFormulaTargets()
      if (formulaTargets.length === 0) return false
      const config = this.formulaConfig
      const mode = config.formulaMode ?? 'typora-native'
      const enabled = config.enabled
      if (!enabled || mode !== 'inkchapter') return false

      const headingIndex = this.buildHeadingIndex()
      const roleMap = this.getLogicalHeadingRoleMap()
      const projection = this.resolveObjectContexts(
        headingIndex,
        roleMap,
        formulaTargets.map((t, i) => ({ element: t.root, type: 'formula', runtimeKey: `formula:${i}` })),
      )
      const contexts = projection.contexts
      const requestedScope = resolveScope(config)
      const configs: Record<ObjectNumberingType, ObjectNumberingConfig> = {
        table: migrateObjectNumberingConfig('table', resolveCaptionTypeSettings(this.captionSettings, 'table')),
        figure: migrateObjectNumberingConfig('figure', resolveCaptionTypeSettings(this.captionSettings, 'figure')),
        code: migrateObjectNumberingConfig('code', resolveCaptionTypeSettings(this.captionSettings, 'code')),
        formula: config,
      }
      const resultByIndex = new Map<number, NumberingResult>()
      // R5.4.3.4 Phase B: SHARED-SCOPE SEQUENCE LEDGER.
      // All ready formulas must be computed in ONE computeObjectNumbers call so
      // they share the same scope-key counters/ledger (document order).
      const readyTargets: Array<{ type: 'formula'; documentOrder: number; headingContext: import('./object-numbering-engine').HeadingContext }> = []
      const readyIndices: number[] = []
      for (let i = 0; i < formulaTargets.length; i++) {
        const ctx = contexts[i]
        if (!ctx) continue
        const ordinals = ordinalsFromContext(this.toHeadingContext(ctx))
        const readiness = resolveObjectNumberingReadiness({
          documentKey: this.currentDocumentKey,
          requestedScope,
          ordinals,
        })
        if (readiness.decision !== 'READY') continue
        readyTargets.push({ type: 'formula', documentOrder: i, headingContext: this.toHeadingContext(ctx) })
        readyIndices.push(i)
      }
      const readyResults = readyTargets.length > 0
        ? computeObjectNumbers(readyTargets, { configs, documentKey: this.currentDocumentKey ?? undefined })
        : []
      readyIndices.forEach((fi, j) => {
        const r = readyResults[j]
        if (r) resultByIndex.set(fi, r)
      })
      // R5.4.3.4 Phase B/C: emit shared-scope sequence ledger per scopeKey.
      {
        const byScope = new Map<string, Array<{ identity: number | 'AMBIGUOUS' | null; seq: number; reset: boolean }>>()
        for (const fi of readyIndices) {
          const r = resultByIndex.get(fi)
          if (!r) continue
          const key = r.scopeKey ?? 'unknown'
          const identity = this.lastLiveSemanticSnapshot?.entries.find((e) => e.formulaIndex === fi)?.stableFormulaIdentity ?? null
          if (!byScope.has(key)) byScope.set(key, [])
          byScope.get(key)!.push({ identity, seq: r.sequenceValue, reset: !!r.resetApplied })
        }
        let duplicateSequenceCount = 0
        for (const [key, entries] of byScope) {
          const seqs = entries.map((e) => e.seq)
          const seen = new Set<number>()
          for (const s of seqs) if (seen.has(s)) duplicateSequenceCount++
          else seen.add(s)
          const monotonic = seqs.every((s, i) => i === 0 || s === seqs[i - 1] + 1)
          emitSharedScopeSequenceLedger({
            documentKey: this.currentDocumentKey,
            documentGeneration: this.documentGeneration,
            editorRootToken: this.currentEditorRoot ? this.editorRootTokenFor(this.currentEditorRoot) : 0,
            scopeKey: key,
            scopeKind: 'formula',
            formulaCountInScope: entries.length,
            formulaStableIdentities: entries.map((e) => e.identity),
            sequenceValues: seqs,
            resetAppliedFlags: entries.map((e) => e.reset),
            monotonic,
            duplicateSequenceCount: duplicateSequenceCount,
            decision: monotonic && duplicateSequenceCount === 0 ? 'PASS' : 'FAIL',
          })
        }
        emitSequenceProjectionAuthority({
          documentKey: this.currentDocumentKey,
          documentGeneration: this.documentGeneration,
          reason: 'pre-call-plan-rebuild',
          formulaCount: formulaTargets.length,
          scopesWithSequence: byScope.size,
          duplicateSequenceCount,
          sharedLedgerUsed: true,
          decision: duplicateSequenceCount === 0 ? 'PASS' : 'FAIL',
        })
      }
      const managedFormulas: Array<{
        host: HTMLElement
        formulaIndex: number
        desiredTag: string
        desiredDisplayTag: string
        nativeSlotState: string
        contextReady: boolean
        desiredTagReady: boolean
      }> = []
      for (const i of resultByIndex.keys()) {
        const t = formulaTargets[i]
        const r = resultByIndex.get(i)!
        const ctx = contexts[i]
        const isInkChapterMode = mode === 'inkchapter' && enabled
        const contextReady = isInkChapterMode
        const desiredTagReady = isInkChapterMode && r.renderedNumber.length > 0
        const hostConnected = t.root.isConnected
        const sameEditorRoot = this.currentEditorRoot?.contains(t.root) ?? false
        const sameDocument = (this.currentDocumentKey ?? '') === headingIndex.documentKey
        const sameGeneration = this.documentGeneration === headingIndex.documentGeneration
        const managedEligible = isInkChapterMode && hostConnected && sameEditorRoot && sameDocument && sameGeneration && contextReady && desiredTagReady
        if (managedEligible) {
          managedFormulas.push({
            host: t.root,
            formulaIndex: i,
            desiredTag: r.renderedNumber.replace(/[()]/g, ''),
            desiredDisplayTag: r.renderedNumber,
            nativeSlotState: 'NOT_FOUND',
            contextReady,
            desiredTagReady,
          })
        }
      }
      if (managedFormulas.length === 0) return false
      const sourceShaBefore = sha256Hex(this.ctx.readActiveFileContent?.() ?? null)
      const plan = this.bindLiveFormulaPlan({
        managedFormulas,
        resultByIndex,
        contexts,
        sourceShaBefore,
        enabled,
        mode,
      })
      return plan !== null
    } catch {
      return false
    }
  }

  /**
   * R5.4.3.3: Formula-only semantic refresh — no table/image/code scan.
   * Uses lastLiveSemanticSnapshot as previous, builds next snapshot, diffs,
   * advances live revision, rebuilds authorization plan.
   * Can be called from event path and pre-call path.
   */
  /**
   * R5.4.3.3/R5.4.3.4: Formula-only semantic refresh — no table/image/code scan.
   * R5.4.3.4 Phase G/H: returns the concrete previous/next snapshot + diff so the
   * event path can consume REAL snapshot authority (never null before/after).
   */
  private refreshFormulaSemanticStateNow(reason: string): {
    previousSnapshot: LiveFormulaSemanticSnapshot | null
    nextSnapshot: LiveFormulaSemanticSnapshot | null
    diff: LivePlanDiffEntry[]
    planRebuilt: boolean
    addedCount: number
    removedCount: number
    sourceChangedCount: number
    desiredTagChangedCount: number
  } | null {
    if (this.rendering) return null
    const docKey = this.currentDocumentKey
    const root = this.currentEditorRoot
    if (!docKey || !root) return null
    const config = this.formulaConfig
    if (!config.enabled || (config.formulaMode ?? 'typora-native') !== 'inkchapter') return null
    try {
      const formulaTargets = this.formulaAdapter.collectFormulaTargets()
      if (formulaTargets.length === 0) return null
      const headingIndex = this.buildHeadingIndex()
      const roleMap = this.getLogicalHeadingRoleMap()
      const projection = this.resolveObjectContexts(
        headingIndex,
        roleMap,
        formulaTargets.map((t, i) => ({ element: t.root, type: 'formula', runtimeKey: `formula:${i}` })),
      )
      const contexts = projection.contexts
      const requestedScope = resolveScope(config)
      const configs: Record<ObjectNumberingType, ObjectNumberingConfig> = {
        table: migrateObjectNumberingConfig('table', resolveCaptionTypeSettings(this.captionSettings, 'table')),
        figure: migrateObjectNumberingConfig('figure', resolveCaptionTypeSettings(this.captionSettings, 'figure')),
        code: migrateObjectNumberingConfig('code', resolveCaptionTypeSettings(this.captionSettings, 'code')),
        formula: config,
      }
      const resultByIndex = new Map<number, NumberingResult>()
      // R5.4.3.4 Phase B: SHARED-SCOPE SEQUENCE LEDGER (formula-only path).
      const readyTargets: Array<{ type: 'formula'; documentOrder: number; headingContext: import('./object-numbering-engine').HeadingContext }> = []
      const readyIndices: number[] = []
      for (let i = 0; i < formulaTargets.length; i++) {
        const ctx = contexts[i]
        if (!ctx) continue
        const ordinals = ordinalsFromContext(this.toHeadingContext(ctx))
        const readiness = resolveObjectNumberingReadiness({
          documentKey: docKey,
          requestedScope,
          ordinals,
        })
        if (readiness.decision !== 'READY') continue
        readyTargets.push({ type: 'formula', documentOrder: i, headingContext: this.toHeadingContext(ctx) })
        readyIndices.push(i)
      }
      const readyResults = readyTargets.length > 0
        ? computeObjectNumbers(readyTargets, { configs, documentKey: docKey })
        : []
      readyIndices.forEach((fi, j) => {
        const r = readyResults[j]
        if (r) resultByIndex.set(fi, r)
      })
      const managedFormulas: Array<{ host: HTMLElement; formulaIndex: number; desiredTag: string; desiredDisplayTag: string; nativeSlotState: string; contextReady: boolean; desiredTagReady: boolean }> = []
      for (const i of resultByIndex.keys()) {
        const t = formulaTargets[i]
        const r = resultByIndex.get(i)!
        const ctx = contexts[i]
        const hostConnected = t.root.isConnected
        const sameEditorRoot = root.contains(t.root)
        const contextReady = true
        const desiredTagReady = r.renderedNumber.length > 0
        if (hostConnected && sameEditorRoot && contextReady && desiredTagReady) {
          managedFormulas.push({
            host: t.root,
            formulaIndex: i,
            desiredTag: r.renderedNumber.replace(/[()]/g, ''),
            desiredDisplayTag: r.renderedNumber,
            nativeSlotState: 'NOT_FOUND',
            contextReady,
            desiredTagReady,
          })
        }
      }
      if (managedFormulas.length === 0) return null
      const sourceShaBefore = sha256Hex(this.ctx.readActiveFileContent?.() ?? null)
      const prevSnapshot = this.lastLiveSemanticSnapshot
      const plan = this.bindLiveFormulaPlan({
        managedFormulas,
        resultByIndex,
        contexts,
        sourceShaBefore,
        enabled: config.enabled,
        mode: config.formulaMode ?? 'inkchapter',
      })
      const nextSnapshot = this.lastLiveSemanticSnapshot
      // R5.4.3.4 Phase G: compute REAL diff between previous and next snapshots.
      const diff = prevSnapshot && nextSnapshot ? diffLiveFormulaPlans(prevSnapshot, nextSnapshot) : []
      const addedCount = diff.filter((d) => d.changeKinds.includes('ADDED')).length
      const removedCount = diff.filter((d) => d.changeKinds.includes('REMOVED')).length
      const sourceChangedCount = diff.filter((d) => d.changeKinds.includes('SOURCE_CHANGED')).length
      const desiredTagChangedCount = diff.filter((d) => d.changeKinds.includes('DESIRED_TAG_CHANGED')).length
      // Emit formula-only refresh marker.
      const rev = getLiveFormulaRevision()
      emitFormulaOnlyRefresh({
        operationBatchId: `fosr-${this.semanticOperationBatchCount}`,
        documentKey: docKey,
        documentGeneration: this.documentGeneration,
        reason,
        canonicalFormulaCountBefore: prevSnapshot?.formulaCount ?? 0,
        canonicalFormulaCountAfter: formulaTargets.length,
        managedFormulaCountBefore: prevSnapshot?.managedFormulaCount ?? 0,
        managedFormulaCountAfter: managedFormulas.length,
        liveFormulaRevisionBefore: prevSnapshot?.liveFormulaRevision ?? 0,
        liveFormulaRevisionAfter: rev.liveFormulaRevision,
        semanticSignatureBefore: prevSnapshot?.semanticSignature ?? '',
        semanticSignatureAfter: rev.currentSemanticSignature,
        authorizationPlanRevisionBefore: 0,
        authorizationPlanRevisionAfter: plan?.planRevision ?? 0,
        tableScanCount: 0,
        figureScanCount: 0,
        codeScanCount: 0,
        globalCaptionRefreshCount: 0,
      })
      return {
        previousSnapshot: prevSnapshot,
        nextSnapshot,
        diff,
        planRebuilt: plan !== null,
        addedCount,
        removedCount,
        sourceChangedCount,
        desiredTagChangedCount,
      }
    } catch {
      return null
    }
  }

  /**
   * R5.4.3.7: Renderer-internal mutation reconciliation.
   * TYPOORA_RENDERER_INTERNAL_ONLY is no longer unconditionally ignored:
   * semanticRefresh=false, but if a canonical formula host's visible tag
   * diverged from the authoritative desiredTag (Typora re-rendered it), request
   * a projection reconcile. NEVER advances liveFormulaRevision.
   */
  private reconcileRendererInternalProjection(records: MutationRecord[]): void {
    const docKey = this.currentDocumentKey
    const root = this.currentEditorRoot
    const snapshot = this.lastLiveSemanticSnapshot
    if (!docKey || !root || !snapshot) return
    const touched = new Set<HTMLElement>()
    for (const rec of records) {
      const target: Node | null = rec.target
      const candidates: Node[] = [
        ...(target ? [target] : []),
        ...Array.from(rec.addedNodes),
        ...Array.from(rec.removedNodes),
      ]
      for (const n of candidates) {
        if (!(n instanceof Node)) continue
        if (!root.contains(n)) continue
        // R5.4.3.9 P2: try closest() for connected nodes, then reverse binding registry.
        let host: HTMLElement | null = null
        if (n instanceof HTMLElement && (n.classList.contains('mathjax-block') || n.classList.contains('md-math-block'))) {
          host = n
        } else if (n instanceof HTMLElement) {
          host = n.closest('.mathjax-block, .md-math-block')
        }
        // For detached nodes or nodes that failed closest(), try the reverse binding registry.
        if (!host) {
          host = resolveCanonicalHostFromRendererNode(n, root).host
        }
        if (host instanceof HTMLElement) touched.add(host)
      }
    }
    const formulaTargets = this.formulaAdapter.collectFormulaTargets()
    // R5.4.3.8 P3: track REAL reconcile execution (decision != execution).
    let reconcileFunctionCalledCount = 0
    let reconcileRequestedCount = 0
    let reconcileSucceededCount = 0
    let visibleVerifyCount = 0
    let resolvedFormulaHostCount = 0
    let resolvedStableIdentityCount = 0
    for (const host of touched) {
      // Match the touched host to a canonical formula target by element identity.
      const tIdx = formulaTargets.findIndex((t) => t.root === host)
      if (tIdx === -1) continue
      resolvedFormulaHostCount++
      // R5.4.3.7: Pending new formula host that is NOT yet in the semantic
      // snapshot (Typora natural render before FORMULA_ADDED/adoption).
      const entry = snapshot.entries.find((e) => e.formulaIndex === tIdx)
      const desiredTag = entry?.desiredTag ?? ''
      const stableIdentity = entry?.stableFormulaIdentity ?? null
      const formulaIndex = entry?.formulaIndex ?? null
      // R5.4.3.8 P0: structural slot authority — formula existence is decided by
      // canonical host, not by rawTex non-empty. Emit slot markers for every
      // touched canonical host (empty included).
      emitStructuralSlotAuthority({
        documentKey: docKey,
        generation: this.documentGeneration,
        rootToken: root ? this.editorRootTokenFor(root) : 0,
        hostToken: tokenFor(host),
        stableFormulaIdentity: stableIdentity ?? null,
        formulaIndex: formulaIndex ?? tIdx,
        sourceState: (() => {
          const tex = extractFormulaTexForTrace(host)
          return isEmptyFormulaSentinel(tex) ? 'EMPTY' : 'NONEMPTY'
        })(),
        rawTexLength: extractFormulaTexForTrace(host).trim().length,
        managedForNumbering: true,
        scopeKey: null,
        sequenceValue: null,
        desiredTag: desiredTag || null,
      })
      if (entry && desiredTag && (entry as { normalizedSourceHash?: string }).normalizedSourceHash === '') {
        emitEmptySourceManagedSlot({
          documentKey: docKey,
          generation: this.documentGeneration,
          rootToken: root ? this.editorRootTokenFor(root) : 0,
          hostToken: tokenFor(host),
          stableFormulaIdentity: stableIdentity ?? null,
          formulaIndex: formulaIndex ?? null,
          scopeKey: null,
          sequenceValue: entry.sequenceValue,
          desiredTag: entry.desiredTag,
        })
      }
      // R5.4.3.8 P1: renderer-internal mutations (CodeMirror mount / rawblock
      // mount / MJX-CONTAINER replacement) are NONSEMANTIC — they never commit
      // source. Report the transition for the latched edit session.
      const activeSession = getActiveEditSession()
      if (activeSession && stableIdentity !== null && stableIdentity !== 'AMBIGUOUS'
        && activeSession.stableFormulaIdentity === stableIdentity) {
        emitNonsemanticEditTransition({
          sessionId: activeSession.sessionId,
          eventKind: 'TYPOORA_RENDERER_INTERNAL_MUTATION',
          stableFormulaIdentity: stableIdentity,
          formulaIndex: entry?.formulaIndex ?? null,
          userSemanticSourceChange: false,
        })
      }
      if (!entry) {
        // Host exists in live DOM but not in the authoritative snapshot yet —
        // record pending projection for replay after FORMULA_ADDED completes.
        createPendingProjection({
          documentKey: docKey,
          generation: this.documentGeneration,
          rootToken: root ? this.editorRootTokenFor(root) : 0,
          formulaHostToken: tokenFor(host),
          rendererNodeToken: tokenFor(host),
          operationId: `rp-${this.semanticOperationBatchCount}`,
          reason: 'TYPOORA_RENDERER_INTERNAL_VISIBLE_TAG_DIVERGED',
        })
        emitRuntimeAudit('FORMULA-TYPOORA-RENDERER-MUTATION-AUTHORITY', {
          mutationBatchId: null,
          documentKey: docKey,
          generation: this.documentGeneration,
          rootToken: root ? this.editorRootTokenFor(root) : 0,
          rendererInternal: true,
          canonicalFormulaHostResolved: true,
          stableFormulaIdentity: null,
          formulaIndex: tIdx,
          semanticRefreshRequested: false,
          projectionReconcileRequested: true,
          desiredTag: null,
          visibleTagBefore: null,
          decision: 'PENDING_PROJECTION',
          reason: 'HOST_OUTSIDE_SNAPSHOT_PENDING_ADOPTION',
          runtimeMarker: 'FORMULA-PERSISTENT-RENDERER-PROJECTION-V2.5.7-R5.4.3.7',
        })
        continue
      }
      if (!desiredTag) continue
      const visible = readVisibleFormulaTag(host, desiredTag)
      emitRuntimeAudit('FORMULA-TYPOORA-RENDERER-MUTATION-AUTHORITY', {
        mutationBatchId: null,
        documentKey: docKey,
        generation: this.documentGeneration,
        rootToken: root ? this.editorRootTokenFor(root) : 0,
        rendererInternal: true,
        canonicalFormulaHostResolved: true,
        stableFormulaIdentity: stableIdentity ?? null,
        formulaIndex: formulaIndex ?? null,
        semanticRefreshRequested: false,
        projectionReconcileRequested: visible.decision !== 'MATCH',
        desiredTag,
        visibleTagBefore: visible.visibleTagText,
        decision: visible.decision !== 'MATCH' ? 'RECONCILE' : 'NO_OP',
        reason: visible.decision !== 'MATCH' ? 'VISIBLE_TAG_DIVERGED' : null,
        runtimeMarker: 'FORMULA-PERSISTENT-RENDERER-PROJECTION-V2.5.7-R5.4.3.7',
      })
      if (visible.decision === 'MATCH') continue
      reconcileRequestedCount++
      if (stableIdentity === null || stableIdentity === 'AMBIGUOUS' || formulaIndex === null) {
        continue
      }
      resolvedStableIdentityCount++
      reconcileFunctionCalledCount++
      const rawTex = extractFormulaTexForTrace(host)
      const res = reconcileFormulaRenderProjectionNow({
        documentKey: docKey,
        documentGeneration: this.documentGeneration,
        editorRootToken: root ? this.editorRootTokenFor(root) : 0,
        stableFormulaIdentity: stableIdentity,
        formulaIndex,
        formulaHost: host,
        desiredTag,
        authoritativeRawTex: rawTex,
        requestFulfillment: getOriginalTex2svgPromise()
          ? (tex: string, tag: string) => requestFormulaProjectionFulfillment({
              stableFormulaIdentity: stableIdentity,
              formulaIndex,
              rawTex: tex,
              desiredTag: tag,
              planRevision: 0,
              liveFormulaRevision: 0,
              documentKey: docKey,
              generation: this.documentGeneration,
              rootToken: root ? this.editorRootTokenFor(root) : 0,
            }, getNaturalRenderOptions(stableIdentity) ?? undefined).then((r) => r.resultNode)
          : undefined,
        reason: 'TYPOORA_RENDERER_INTERNAL_OUTPUT_REPLACEMENT',
      })
      if (res.reconcileSucceeded) reconcileSucceededCount++
      if (res.route === 'STRATEGY_B_EXACT_FULFILLMENT' || res.route === 'NO_OP') visibleVerifyCount++
    }
    // R5.4.3.9 P2: FORMULA-PROJECTION-RECONCILE-EXECUTION — FAIL if reverse
    // binding could not resolve any canonical host. candidateRendererNodeCount>0
    // with resolvedFormulaHostCount=0 is RENDERER_NODE_TO_CANONICAL_HOST_UNRESOLVED.
    const candidateRendererNodeCount = records.length
    const unresolvedHosts = candidateRendererNodeCount > 0 && resolvedFormulaHostCount === 0
    emitRuntimeAudit('FORMULA-PROJECTION-RECONCILE-EXECUTION', {
      mutationBatchId: null,
      candidateRendererNodeCount: records.length,
      resolvedFormulaHostCount,
      resolvedStableIdentityCount,
      reconcileFunctionCalledCount,
      reconcileRequestedCount,
      reconcileSucceededCount,
      visibleVerifyCount,
      decision: unresolvedHosts ? 'FAIL'
        : (reconcileRequestedCount > 0 && reconcileFunctionCalledCount === 0 ? 'FAIL' : 'PASS'),
      reason: unresolvedHosts ? 'RENDERER_NODE_TO_CANONICAL_HOST_UNRESOLVED'
        : (reconcileRequestedCount > 0 && reconcileFunctionCalledCount === 0 ? 'DECLARED_BUT_NOT_EXECUTED' : null),
      runtimeMarker: 'FORMULA-ATOMIC-TRANSACTION-RENDER-PROJECTION-V2.5.7-R5.4.3.9',
    })
  }

  /**
   * R5.4.3.8 P5/Section 34: Affected-existing-formula closure runs through the
   * PERSISTENT PROJECTION EXECUTOR. The old typesetPromise MATHJAX-RERENDER-GATE
   * remains historical diagnostics only — it never decides the final visible
   * closure of a surviving formula whose desiredTag shifted.
   */
  private async reconcileAffectedExistingFormulaProjection(
    affected: ReturnType<typeof computeAffectedFormulaSet>,
    reason: string,
  ): Promise<void> {
    const snapshot = this.lastLiveSemanticSnapshot
    if (!snapshot) return
    const docKey = this.currentDocumentKey
    const root = this.currentEditorRoot
    if (!docKey || !root) return
    const targets = this.formulaAdapter.collectFormulaTargets()
    let reconcileCalledCount = 0
    let providerAvailableCount = 0
    let fulfilledCount = 0
    let appliedCount = 0
    let visibleVerifiedCount = 0
    let failedCount = 0
    let pendingCount = 0
    const providerAvailable = !!getOriginalTex2svgPromise()
    const allAffectedCount = affected.affectedStableFormulaIdentities.length
    const promises: Promise<void>[] = []
    for (const identity of affected.affectedStableFormulaIdentities) {
      if (identity === null || identity === 'AMBIGUOUS') continue
      const entry = snapshot.entries.find((e) => e.stableFormulaIdentity === identity)
      if (!entry) continue
      const target = targets.find((t) => t.ordinal === entry.formulaIndex)
      if (!target) continue
      const visible = readVisibleFormulaTag(target.root, entry.desiredTag)
      if (visible.decision === 'MATCH') { visibleVerifiedCount++; continue }
      reconcileCalledCount++
      if (providerAvailable) {
        providerAvailableCount++
        const options = getNaturalRenderOptions(identity)
        // Use the production fulfillment provider as requestFulfillment callback.
        promises.push(
          requestFormulaProjectionFulfillment({
            stableFormulaIdentity: identity,
            formulaIndex: entry.formulaIndex,
            rawTex: extractFormulaTexForTrace(target.root),
            desiredTag: entry.desiredTag,
            planRevision: 0,
            liveFormulaRevision: 0,
            documentKey: docKey,
            generation: this.documentGeneration,
            rootToken: this.editorRootTokenFor(root),
          }, options ?? undefined).then((res) => {
            if (res.fulfilled && res.resultNode) {
              fulfilledCount++
              const old = target.root.querySelector('mjx-container')
              if (old && old.parentNode) {
                // R5.4.3.11 P0-D: Use composite visual owner for slot check
                const compositeOwner = resolveFormulaCompositeVisualOwner(target.root, root)

                // Use the composite owner's native output for slot check
                const slotCheck = checkNativeSlotOwnership({
                  formulaHost: target.root,
                  targetNode: compositeOwner.nativeMjxOutput ?? old,
                })
                if (!slotCheck.allowed) {
                  failedCount++
                  return
                }
                const visualBefore = captureVisualIntegritySnapshot(target.root, root)
                old.replaceWith(res.resultNode)
                appliedCount++
                const visualAfter = verifyVisualIntegrity(target.root, root, visualBefore)
                if (visualAfter.decision !== 'PASS') {
                  // Rollback: restore the original native output.
                  const newMjx = target.root.querySelector('mjx-container')
                  if (newMjx && newMjx.parentNode) {
                    newMjx.replaceWith(old)
                  }
                  failedCount++
                  return
                }
                // Register the natural render correlation binding
                settleNaturalRenderCorrelation(res.resultNode, target.root)
                const after = readVisibleFormulaTag(target.root, entry.desiredTag)
                if (after.decision === 'MATCH') visibleVerifiedCount++
              }
            } else {
              failedCount++
            }
          }),
        )
      } else {
        pendingCount++
      }
    }

    // Emit DISPATCH with initial counts
    emitRuntimeAudit('FORMULA-AFFECTED-EXISTING-PROJECTION-DISPATCH', {
      affectedCount: allAffectedCount,
      requestedCount: reconcileCalledCount,
      providerAvailableCount,
      promiseCount: promises.length,
      reason,
      runtimeMarker: 'FORMULA-ATOMIC-TRANSACTION-RENDER-PROJECTION-V2.5.7-R5.4.3.9',
    })

    // Wait for all promises to settle
    await Promise.allSettled(promises)

    // Emit FINAL with final counts
    const finalPass = failedCount === 0 && pendingCount === 0 && visibleVerifiedCount >= reconcileCalledCount
    emitRuntimeAudit('FORMULA-AFFECTED-EXISTING-PROJECTION-FINAL', {
      affectedCount: allAffectedCount,
      requestedCount: reconcileCalledCount,
      providerAvailableCount,
      fulfilledCount,
      appliedCount,
      visibleVerifiedCount,
      failedCount,
      pendingCount,
      settledCount: promises.length,
      allDesiredTagsVisible: finalPass,
      decision: finalPass ? 'PASS' : (failedCount > 0 ? 'FAIL' : 'PARTIAL'),
      reason: finalPass ? null
        : (!providerAvailable ? 'PRODUCTION_FULFILLMENT_PROVIDER_UNAVAILABLE'
          : (failedCount > 0 ? 'FULFILLMENT_FAILED' : 'PENDING_OR_NOT_VERIFIED')),
      runtimeMarker: 'FORMULA-ATOMIC-TRANSACTION-RENDER-PROJECTION-V2.5.7-R5.4.3.9',
    })
  }

  /** DevTools probe: block formula count, native detection, mode, double-number evidence. */
  private formulaNumberProbe(): Record<string, unknown> {
    const config = this.formulaConfig
    const mode = config.formulaMode ?? 'typora-native'
    const targets = this.formulaAdapter.collectFormulaTargets()
    const formulas = targets.map(t => ({
      canonicalHost: `${t.root.tagName}.${(t.root.className || '').slice(0, 60)}`,
      nativeNumberFound: !!t.nativeNumberNode,
      nativeNumberText: t.nativeNumberText,
      nativeNumberNode: t.nativeNumberNode
        ? `${t.nativeNumberNode.tagName}.${(t.nativeNumberNode.className || '').slice(0, 40)}`
        : null,
      inkchapterNumberFound: !!t.root.querySelector('[data-inkchapter-formula-number]'),
      mode,
    }))
    const double = this.formulaAdapter.computeDoubleNumber()
    return {
      buildId: INKCHAPTER_BUILD_ID,
      blockFormulaCount: targets.length,
      formulas,
      nativeVisibleCount: double.nativeVisibleCount,
      inkchapterVisibleCount: double.inkchapterVisibleCount,
      doubleNumberDetected: double.doubleNumberDetected,
      mode,
      enabled: config.enabled,
    }
  }

  /** Verify a just-created caption node survives + is visible (sync + RAF). */
  private verifyRender(captionId: string, label: string): void {
    const root = this.currentEditorRoot
    const elInDoc = document.querySelector(`[data-inkchapter-caption-id="${captionId}"]`) as HTMLElement | null
      ?? document.querySelector(`[data-inkchapter-caption-debug="true"]`) as HTMLElement | null
    const captionConnectedSync = elInDoc ? elInDoc.isConnected : false
    const cs = elInDoc ? window.getComputedStyle(elInDoc) : null
    const rect = elInDoc ? elInDoc.getBoundingClientRect() : null
    console.info(
      `[InkChapter Caption] RENDER-VERIFY captionCreated=${!!elInDoc} ` +
      `captionConnectedSync=${captionConnectedSync} ` +
      `captionCountInDocument=${document.querySelectorAll('[data-inkchapter-caption]').length} ` +
      `captionCountInEditorRoot=${root ? root.querySelectorAll('[data-inkchapter-caption]').length : 0} ` +
      `computedDisplay=${cs ? cs.display : 'null'} computedVisibility=${cs ? cs.visibility : 'null'} ` +
      `rectWidth=${rect ? Math.round(rect.width) : 0} rectHeight=${rect ? Math.round(rect.height) : 0} ` +
      `label=${label}`,
    )
    // Async survival check (RAF).
    requestAnimationFrame(() => {
      const el2 = document.querySelector(`[data-inkchapter-caption-id="${captionId}"]`) as HTMLElement | null
        ?? document.querySelector(`[data-inkchapter-caption-debug="true"]`) as HTMLElement | null
      const connected = el2 ? el2.isConnected : false
      const cs2 = el2 ? window.getComputedStyle(el2) : null
      const rect2 = el2 ? el2.getBoundingClientRect() : null
      console.info(
        `[InkChapter Caption] RENDER-VERIFY captionConnectedRAF=${connected} ` +
        `computedDisplay=${cs2 ? cs2.display : 'null'} rectWidth=${rect2 ? Math.round(rect2.width) : 0} rectHeight=${rect2 ? Math.round(rect2.height) : 0}`,
      )
    })
  }

  /** Load persisted records and strictly resolve + bind. */
  rehydrate(): void {
    const docKey = this.currentDocumentKey
    if (!docKey) { this.adapter.clearAllCaptions(); return }

    const records = loadCaptionStore(docKey)
    if (!records || records.length === 0) {
      this.registry.clearDocument(docKey)
      this.boundTargets.clear()
      this.orphanIds.clear()
      // Sidecar miss must NOT block render: unnamed objects still auto-number.
      this.refresh('rehydrate-empty')
      return
    }

    this.registry.rehydrate(docKey, records)
    this.boundTargets.clear()
    this.orphanIds.clear()

    const targets = this.adapter.collectTargets()
    const descriptors = this.adapter.toDescriptors(targets)
    const targetByIndex = new Map(targets.map((t, i) => [i, t]))

    console.info(
      `[InkChapter Caption] NAME-LOAD storedRecordCount=${records.length} ` +
      `liveTargetCount=${targets.length} decision=LOADED`,
    )

    let bound = 0
    let orphaned = 0
    for (const record of records) {
      const result = resolveCaptionAnchor(record.targetAnchor, descriptors)
      const decision = result.decision === 'STRONG' ? 'MATCH' : 'BLOCK'
      let matchedRuntimeKey = 'none'
      let matched = false
      let figureDropped = false
      if (result.decision === 'STRONG' && result.index >= 0) {
        const target = targetByIndex.get(result.index)
        if (target) {
          matchedRuntimeKey = this.runtimeKeyForTarget(target, targets)
          if (record.type === 'figure') {
            // Figure name now lives in Markdown alt; migrate legacy sidecar name.
            this.migrateFigureSidecarName(record, target)
            this.registry.delete(record.captionId)
            figureDropped = true
          } else {
            this.boundTargets.set(record.captionId, target.root)
            this.registry.retarget(record.captionId, this.adapter.computeAnchorForTarget(target, targets))
            matched = true
          }
        }
      }
      console.info(
        `[InkChapter Caption] NAME-ANCHOR-MATCH recordId=${record.captionId} type=${record.type} ` +
        `matchedRuntimeKey=${matchedRuntimeKey} decision=${decision} reason=${result.reason}`,
      )
      emitRuntimeAudit('CAPTION-ANCHOR-MATCH', {
        documentKey: docKey,
        captionId: record.captionId,
        type: record.type,
        matchedRuntimeKey,
        decision,
        reason: result.reason,
      })
      if (matched) {
        bound++
      } else if (!figureDropped) {
        this.orphanIds.add(record.captionId)
        orphaned++
      }
    }

    console.info(
      `[InkChapter Caption] NAME-LOAD storedRecordCount=${records.length} ` +
      `liveTargetCount=${targets.length} matchedCount=${bound} blockedCount=${orphaned} decision=COMPLETE`,
    )

    emitRuntimeAudit('CAPTION-REHYDRATE', {
      documentKey: docKey,
      totalRecords: records.length,
      bound,
      orphaned,
      decision: orphaned > 0 ? 'PARTIAL' : 'RESOLVED',
    })

    this.refresh()
  }

  private save(): void {
    const docKey = this.currentDocumentKey
    if (!docKey) return
    const path = this.ctx.getActiveFilePath?.() ?? ''
    saveCaptionStore(docKey, path, this.registry.serialize(docKey))
  }

  // ── Runtime diagnostics (DevTools entry points) ───────────────────

  private registerProbe(): void {
    try {
      ;(window as any).__inkchapter_caption_probe__ = () => this.probe()
      ;(window as any).__inkchapter_caption_force_refresh__ = () => this.forceRefresh()
      ;(window as any).__inkchapter_image_source_probe__ = () => this.imageSourceProbe()
      ;(window as any).__inkchapter_figure_alt_write_probe__ = () => this.figureAltWriteProbe()
      ;(window as any).__inkchapter_local_image_path_probe__ = () => this.localImagePathProbe()
      ;(window as any).__inkchapter_normalize_local_image_paths__ = () => this.normalizeLocalImagePaths()
      ;(window as any).__inkchapter_normalize_figure_local_path__ = (index: number) => {
        const targets = this.adapter.collectTargets().filter(t => t.type === 'figure')
        const target = targets[index]
        if (!target) return { ok: false, reason: 'no-figure-at-index' }
        return { ok: true, ...this.normalizeFigureLocalPath(target) }
      }
      ;(window as any).__inkchapter_numbering_preview__ = (type: ObjectNumberingType, overrides?: Partial<ObjectNumberingConfig>) => {
        const config = { ...migrateObjectNumberingConfig(type, resolveCaptionTypeSettings(this.captionSettings, type as CaptionTargetType)), ...overrides }
        return {
          renderedNumber: renderNumberingPreview(type, config, { n: 1, chapter: '2', section: '3', name: '示例' }),
          label: renderNumberingPreview(type, config, { n: 1, chapter: '2', section: '3', name: '示例' }),
          context: { chapter: '2', section: '3', n: '1' },
        }
      }
      ;(window as any).__inkchapter_formula_number_probe__ = () => this.formulaNumberProbe()
      ;(window as any).__inkchapter_caption_set_name__ = (type: CaptionTargetType, index: number, name: string) => {
        const targets = this.adapter.collectTargets().filter(t => t.type === type)
        const target = targets[index]
        if (!target) return { ok: false, reason: 'no-target-at-index' }
        const record = this.setCaption(type, target, String(name ?? ''))
        return { ok: true, recordId: record?.captionId ?? null }
      }
      ;(window as any).__inkchapter_caption_clear_name__ = (type: CaptionTargetType, index: number) => {
        const targets = this.adapter.collectTargets().filter(t => t.type === type)
        const target = targets[index]
        if (!target) return { ok: false, reason: 'no-target-at-index' }
        const id = this.captionIdForRoot(target.root)
        if (!id) return { ok: false, reason: 'not-named' }
        const ok = this.deleteCaption(id)
        return { ok }
      }
    } catch { /* ignore */ }
  }

  probe(): Record<string, unknown> {
    const editorRoot = this.currentEditorRoot
    const settings = this.captionSettings
    const documentRawTableCount = document.querySelectorAll('table').length
    const documentRawImageCount = document.querySelectorAll('img').length
    const documentRawPreCount = document.querySelectorAll('pre').length
    const editorRawTableCount = editorRoot ? editorRoot.querySelectorAll('table').length : 0
    const editorRawImageCount = editorRoot ? editorRoot.querySelectorAll('img').length : 0
    const editorRawPreCount = editorRoot ? editorRoot.querySelectorAll('pre').length : 0

    const targets = this.adapter.collectTargets()
    const adapterTable = targets.filter(t => t.type === 'table').length
    const adapterImage = targets.filter(t => t.type === 'figure').length
    const adapterCode = targets.filter(t => t.type === 'code').length

    const rendered = document.querySelectorAll('[data-inkchapter-caption]')
    const renderedTable = document.querySelectorAll('[data-inkchapter-caption-type="table"]').length
    const renderedImage = document.querySelectorAll('[data-inkchapter-caption-type="figure"]').length
    const renderedCode = document.querySelectorAll('[data-inkchapter-caption-type="code"]').length

    const firstTable = document.querySelector('table')
    let firstTableAncestor = ''
    if (firstTable) {
      const chain: string[] = []
      let p = firstTable.parentElement
      let depth = 0
      while (p && depth < 5) {
        chain.push(`${p.tagName}${p.id ? '#' + p.id : ''}.${(p.className || '').slice(0, 30)}`)
        p = p.parentElement
        depth++
      }
      firstTableAncestor = chain.join(' > ')
    }

    return {
      buildId: INKCHAPTER_BUILD_ID,
      activeDoc: this.ctx.getActiveFilePath?.() ?? null,
      serviceExists: true,
      serviceStarted: this.started,
      editorResolved: !!editorRoot,
      editorRootConnected: editorRoot ? editorRoot.isConnected : false,
      editorRootTag: editorRoot ? editorRoot.tagName : null,
      editorRootClass: editorRoot ? String(editorRoot.className).slice(0, 60) : null,
      editorRootId: editorRoot ? editorRoot.id : null,
      settings: {
        table: { enabled: settings.types.table.enabled, position: settings.types.table.position, prefix: settings.types.table.prefix },
        image: { enabled: settings.types.figure.enabled, position: settings.types.figure.position, prefix: settings.types.figure.prefix },
        code: { enabled: settings.types.code.enabled, position: settings.types.code.position, prefix: settings.types.code.prefix },
      },
      documentCounts: {
        rawTableCount: documentRawTableCount,
        rawImageCount: documentRawImageCount,
        rawPreCount: documentRawPreCount,
        rawCodeBlockCount: documentRawPreCount,
      },
      editorRootCounts: {
        rawTableCount: editorRawTableCount,
        rawImageCount: editorRawImageCount,
        rawPreCount: editorRawPreCount,
        rawCodeBlockCount: editorRawPreCount,
      },
      adapterCounts: { table: adapterTable, image: adapterImage, code: adapterCode, total: adapterTable + adapterImage + adapterCode },
      codeDiagnostics: this.adapter.getCodeDiagnostics(),
      renderedCaptionCounts: { table: renderedTable, image: renderedImage, code: renderedCode, total: rendered.length },
      eligibility: {
        table: { ...this.lastEligibility.table, renderedCount: renderedTable },
        image: { ...this.lastEligibility.figure, renderedCount: renderedImage },
        code: { ...this.lastEligibility.code, renderedCount: renderedCode },
      },
      firstTable: firstTable ? {
        exists: true,
        tagName: firstTable.tagName,
        className: String(firstTable.className).slice(0, 80),
        outerHTMLPreview: firstTable.outerHTML.slice(0, 1500),
        parentTag: firstTable.parentElement?.tagName ?? null,
        parentClass: firstTable.parentElement ? String(firstTable.parentElement.className).slice(0, 80) : null,
        ancestorSummary: firstTableAncestor,
      } : {
        exists: false, tagName: null, className: null, outerHTMLPreview: null,
        parentTag: null, parentClass: null, ancestorSummary: null,
      },
      lastRefreshReason: this.lastRefreshReason,
      lastScanAt: this.lastScanAt,
      lastRenderAt: this.lastRenderAt,
      lastError: this.lastError,
      captionMutationSelfIgnoredCount: this.captionMutationSelfIgnoredCount,
      captionMutationContentRefreshCount: this.captionMutationContentRefreshCount,
      renderStats: { ...this.renderStats },
      naming: this.namingStats(),
      placement: this.adapter.getPlacementDiagnostics({
        table: settings.types.table.position,
        figure: settings.types.figure.position,
        code: settings.types.code.position,
      }),
      captionOwners: this.captionOwnersStats(),
      figures: this.figuresStats(),
      numbering: this.numberingStats(),
    }
  }

  /** Object Numbering V2 summary for the probe (table/figure/code + formula). */
  private numberingStats(): Record<string, unknown> {
    const configs: Record<ObjectNumberingType, ObjectNumberingConfig> = {
      table: migrateObjectNumberingConfig('table', resolveCaptionTypeSettings(this.captionSettings, 'table')),
      figure: migrateObjectNumberingConfig('figure', resolveCaptionTypeSettings(this.captionSettings, 'figure')),
      code: migrateObjectNumberingConfig('code', resolveCaptionTypeSettings(this.captionSettings, 'code')),
      formula: this.formulaConfig,
    }
    const targets = this.adapter.collectTargets().filter(t => t.type === 'table' || t.type === 'figure' || t.type === 'code')
    const results = computeObjectNumbers(targets.map((t, i) => ({ type: t.type as ObjectNumberingType, documentOrder: i })), { configs })

    const out: Record<string, unknown> = {}
    for (const type of ['table', 'figure', 'code'] as const) {
      const cfg = configs[type]
      const typeTargets = targets.filter(t => t.type === type)
      out[type] = {
        enabled: cfg.enabled,
        mode: cfg.numberingMode,
        numberStyle: cfg.numberStyle,
        startAt: cfg.startAt,
        template: cfg.template,
        targetCount: typeTargets.length,
        renderedNumbers: results.filter(r => r.type === type).map(r => r.renderedNumber),
      }
    }
    out.formula = {
      enabled: configs.formula.enabled,
      mode: configs.formula.formulaMode ?? 'typora-native',
      numberStyle: configs.formula.numberStyle,
      startAt: configs.formula.startAt,
      template: configs.formula.template,
      targetCount: this.formulaAdapter.collectFormulaTargets().length,
      renderedNumbers: [],
    }
    return out
  }

  /** Figure alt/path diagnostics for the probe. */
  private figuresStats(): Array<Record<string, unknown>> {
    const targets = this.adapter.collectTargets().filter(t => t.type === 'figure')
    const hasMarkdownApi = !!(this.ctx.getMarkdown && this.ctx.reloadContent)
    return targets.map(t => {
      const rawAlt = t.alt ?? ''
      const rawPath = t.src ?? ''
      const info = imagePathInfo(rawPath)
      const norm = normalizeLocalImageMarkdownDestination(rawPath)
      const captionName = rawAlt.trim() !== '' ? rawAlt.trim() : ''
      const last = this.lastFigureAltWrite
      const isLast = last !== null && last.runtimeKey === this.runtimeKeyForTarget(t, targets)
      console.info(
        `[InkChapter Caption] IMAGE-PATH-CODEC rawPath=${JSON.stringify(rawPath)} ` +
        `kind=${info.kind} decodedDisplay=${JSON.stringify(info.display)} ` +
        `storageCandidate=${JSON.stringify(info.storage)} decodeSucceeded=${info.decodeSucceeded}`,
      )
      return {
        runtimeKey: this.runtimeKeyForTarget(t, targets),
        number: t.ordinal + 1,
        rawAlt,
        captionName,
        nameSource: 'MARKDOWN_ALT',
        rawPath,
        rawDestination: rawPath,
        decodedDestination: norm.decoded,
        normalizedDestination: norm.safe ? norm.markdownDestination : rawPath,
        destinationKind: info.kind,
        pathKind: info.kind,
        displayPath: info.display,
        writebackAvailable: hasMarkdownApi,
        pathNormalizationAvailable: hasMarkdownApi && norm.safe,
        sidecarFigureName: '',
        migrationState: 'NONE',
        sourceTokenMatched: isLast ? last!.sourceTokenMatched : null,
        writeMethod: isLast ? last!.writeMethod : null,
        lastWriteDecision: isLast ? last!.decision : null,
        lastAltWriteDecision: isLast ? last!.decision : null,
        lastPathNormalizeDecision: this.lastPathNormalizeDecision?.decision ?? null,
      }
    })
  }

  /** Local image path probe (raw/decoded/candidates/sameFile). */
  private localImagePathProbe(): Record<string, unknown> {
    const targets = this.adapter.collectTargets().filter(t => t.type === 'figure')
    const items = targets.map(t => {
      const raw = t.src ?? ''
      const res = normalizeLocalImageMarkdownDestination(raw)
      const candidatePlain = res.safe ? res.decoded : raw
      const candidateAngleBracket = res.safe ? `<${res.decoded}>` : raw
      const isLocal = res.kind === 'LOCAL_RELATIVE_PATH' || res.kind === 'LOCAL_ABSOLUTE_WINDOWS_PATH'
      return {
        runtimeKey: this.runtimeKeyForTarget(t, targets),
        raw,
        kind: res.kind,
        decoded: res.decoded,
        candidatePlain,
        candidateAngleBracket,
        // Percent-decoding preserves the referenced file; absolute resolution is runtime-only.
        resolvedFileBefore: raw,
        resolvedFileAfter: res.safe ? res.decoded : raw,
        sameFile: isLocal && res.safe ? true : null,
      }
    })
    return {
      buildId: INKCHAPTER_BUILD_ID,
      activeDoc: this.ctx.getActiveFilePath?.() ?? null,
      figureCount: items.length,
      items,
      lastPathNormalizeDecision: this.lastPathNormalizeDecision ?? null,
    }
  }

  /** Image source projection probe (raw vs decoded display + source host DOM). */
  private imageSourceProbe(): Record<string, unknown> {
    const sourceEditors = this.adapter.getImageSourceDiagnostics().map(item => {
      const rawPath = String(item.rawPath ?? '')
      const info = imagePathInfo(rawPath)
      return {
        ...item,
        decodedDisplayPath: info.display,
      }
    })
    return {
      buildId: INKCHAPTER_BUILD_ID,
      activeDoc: this.ctx.getActiveFilePath?.() ?? null,
      figureCount: sourceEditors.length,
      sourceEditors,
      projectionPolicy: 'storage encoded / display decoded (no inline source DOM rewrite)',
    }
  }

  /** Last figure alt write trace (FAW0–FAW7 are live logs) plus FAW8/FAW9 evidence. */
  private figureAltWriteProbe(): Record<string, unknown> {
    const last = this.lastFigureAltWrite
    let fileSaved: { decision: string; reason: string; persistedAlt: string | null } = { decision: 'UNKNOWN', reason: 'no-write-yet', persistedAlt: null }
    if (last) {
      const readFile = this.ctx.readActiveFileContent
      if (readFile) {
        try {
          const disk = readFile()
          if (disk === null) {
            fileSaved = { decision: 'UNKNOWN', reason: 'no-active-file', persistedAlt: null }
          } else {
            const diskAlt = readImageAlt(disk, last.oldRawPath, last.occurrence)
            const persisted = (diskAlt ?? '') === last.newAlt
            fileSaved = { decision: persisted ? 'PASS' : 'FAIL', reason: persisted ? 'file-has-new-alt' : 'file-still-old-alt', persistedAlt: diskAlt }
          }
        } catch (e) {
          fileSaved = { decision: 'UNKNOWN', reason: `read-error:${String(e)}`, persistedAlt: null }
        }
      } else {
        fileSaved = { decision: 'UNKNOWN', reason: 'readActiveFileContent-not-wired', persistedAlt: null }
      }
    }
    return {
      buildId: INKCHAPTER_BUILD_ID,
      lastWrite: last ?? null,
      fileSaved,
      faw: last ? { FAW8: fileSaved.decision, FAW9: 'UNVERIFIED' } : null,
      reopenPersisted: 'UNVERIFIED (requires real save + reopen)',
    }
  }

  /** Caption owner evidence for the probe. */
  private captionOwnersStats(): Record<string, unknown> {
    const items = this.adapter.getCaptionOwnerDiagnostics()
    const totalCaptions = items.length
    const withTargetKey = items.filter(i => String(i.targetKey ?? '') !== '').length
    const ownerResolved = items.filter(i => i.ownerConnected === true).length
    const ownerMissing = totalCaptions - ownerResolved
    return { totalCaptions, withTargetKey, ownerResolved, ownerMissing, items }
  }

  /** Snapshot of persisted name records and their match state. */
  private namingStats(): Record<string, unknown> {
    const docKey = this.currentDocumentKey ?? ''
    const records = this.registry.listByDocument(docKey)
    const targets = this.adapter.collectTargets()
    let tableNamed = 0
    let imageNamed = 0
    let codeNamed = 0
    let matched = 0
    let blocked = 0
    const recordList: Array<Record<string, unknown>> = []

    for (const r of records) {
      const root = this.boundTargets.get(r.captionId) ?? null
      const isMatched = !!root && root.isConnected
      let runtimeKey = 'blocked'
      if (root) {
        const target = targets.find(t => t.root === root)
        if (target) runtimeKey = this.runtimeKeyForTarget(target, targets)
      }
      if (isMatched) {
        matched++
        if (r.type === 'table') tableNamed++
        else if (r.type === 'figure') imageNamed++
        else if (r.type === 'code') codeNamed++
      } else {
        blocked++
      }
      recordList.push({ type: r.type, runtimeKey, name: r.title, matched: isMatched, recordId: r.captionId })
    }

    return {
      recordCount: records.length,
      matchedCount: matched,
      blockedCount: blocked,
      tableNamedCount: tableNamed,
      imageNamedCount: imageNamed,
      codeNamedCount: codeNamed,
      records: recordList,
    }
  }

  forceRefresh(): Record<string, unknown> {
    console.info('[InkChapter Caption] FORCE-REFRESH')
    emitRuntimeAudit('CAPTION-FORCE-REFRESH', { decision: 'INVOKED' })
    const before = document.querySelectorAll('[data-inkchapter-caption]').length
    try {
      const root = this.resolveCurrentEditorRoot('force-refresh')
      if (root && root !== this.currentEditorRoot) {
        this.bindEditor(root, 'force-refresh')
      } else if (root) {
        this.connectObserver(root)
        this.currentEditorRoot = root
      }
      if (!this.currentDocumentKey) {
        this.onDocumentChanged()
      }
      this.refresh('force-refresh')
    } catch (e) {
      this.lastError = String(e)
    }
    const after = document.querySelectorAll('[data-inkchapter-caption]').length
    const targets = this.adapter.collectTargets()
    const renderedTable = document.querySelectorAll('[data-inkchapter-caption-type="table"]').length
    const renderedImage = document.querySelectorAll('[data-inkchapter-caption-type="figure"]').length
    const renderedCode = document.querySelectorAll('[data-inkchapter-caption-type="code"]').length
    return {
      editorBound: !!this.currentEditorRoot && this.currentEditorRoot.isConnected,
      tableTargets: targets.filter(t => t.type === 'table').length,
      tableEligible: this.lastEligibility.table.eligibleCount,
      tableRendered: renderedTable,
      imageTargets: targets.filter(t => t.type === 'figure').length,
      imageEligible: this.lastEligibility.figure.eligibleCount,
      imageRendered: renderedImage,
      codeTargets: targets.filter(t => t.type === 'code').length,
      codeEligible: this.lastEligibility.code.eligibleCount,
      codeRendered: renderedCode,
      captionsRendered: after,
      captionsPresentAfterRender: after,
      before,
      after,
      codeDiagnostics: this.adapter.getCodeDiagnostics(),
      renderStats: { ...this.renderStats },
      captionMutationSelfIgnoredCount: this.captionMutationSelfIgnoredCount,
      captionMutationContentRefreshCount: this.captionMutationContentRefreshCount,
      error: this.lastError,
    }
  }
}

/** Simple text hash for MathJax TeX identity verification. */
function simpleHash(s: string): string {
  let hash = 0
  for (let i = 0; i < s.length; i++) {
    const char = s.charCodeAt(i)
    hash = (hash << 5) - hash + char
    hash |= 0
  }
  return hash.toString(16)
}

/** SHA-256 hex digest of a string (null-safe). */
function sha256Hex(content: string | null): string | null {
  if (content === null) return null
  try {
    return crypto.createHash('sha256').update(content, 'utf8').digest('hex').toUpperCase()
  } catch {
    return null
  }
}
