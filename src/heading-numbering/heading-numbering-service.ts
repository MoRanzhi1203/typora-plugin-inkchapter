import type { PluginSettings } from '@typora-community-plugin/core'
import { Notice } from '@typora-community-plugin/core'
import type { InkChapterSettings } from '../settings/settings-model'
import type {
  HeadingNumberingSettings,
  HeadingSnapshot,
  RenderedHeadingState,
  RefreshReason,
  HeadingLevel,
  HeadingLevelStyle,
  HeadingNumberingPreset,
  MultilevelFormatSegment,
  MultilevelFormatVariants,
  ContextualFormatVariants,
  MaxHeadingLevel,
  HeadingLevelRangeSettings,
  DocumentHeadingLevelOverride,
  HeadingSettingsScope,
  SaveHeadingSettingsRequest,
  DocumentNumberingContext,
  HeadingNumberingScopeStore,
  FormatLibrary,
  CustomNumberingFormat,
  NumberingFormatSource,
} from './heading-types'
import { resolveEffectiveMaxLevel, clampMaxLevel } from './heading-types'
import { computeHeadingNumbering } from './numbering-engine'
import { updateActiveFormatVariant, updateActiveMultilevelFormatVariant, updateActiveContextualFormatVariant, diagnoseHeadingChain } from './numbering-engine'
import { decimalHierarchicalFormatter, extractLabelGaps } from './numbering-formatter'
import { HeadingDomAdapter } from '../infrastructure/heading-dom-adapter'
import { DisposableStore } from '../utils/disposable-store'
import { migrateSettings } from './config-migration'
import { resolveHeadingStructure, resolveStyleSlot } from './heading-structure'
import type { HeadingStructureMode } from './heading-structure'
import {
  validateStrictFirstH1Topline,
  computeDocumentStartSignature,
  shouldRevalidateStrictFirstH1,
  type StrictFirstH1RuntimeState,
  type StrictFirstH1ToplineResult,
} from './strict-document-validator'
import { getPresetLevels, getPresetPreview } from './presets'
import { scanHeadingsForRange, convertHeadingsToBold, type HeadingScanResult, type RangeReduceAction } from './level-range-utils'
import { HeadingLevelRangeEnforcer, type EnforcerCallbacks } from './heading-level-range-enforcer'
import { HeadingOverrideStore } from './heading-override-store'
import type { HeadingOverrideMap } from './numbering-engine'
import { OutlineNumberingController } from './outline-numbering-controller'
import { OutlineToolbarController } from './outline-toolbar-controller'
import type { OutlineToolbarCallbacks } from './outline-toolbar-controller'
import { registerOutlineClickForensic } from './outline-click-forensic'
import * as logger from '../core/logger'
import { recordRuntimeAudit, snapshotHeadingCollection, snapshotNumberingEngine, snapshotApplyDiff, snapshotConfigSource, type NumberingEngineEntry, type ApplyDiffEntry } from './runtime-audit'
import {
  refreshParagraphIndentStyles,
  getCurrentParagraphElement,
  isInExcludedContext,
  canTriggerIndentShortcut,
  isCursorAtEnd,
  setParagraphIndentMode,
  getParagraphIndentMode,
  writeBlockProbeDiagnostic,
  classifyEditorMutation,
  resolveCurrentBlockFromSelection,
  resolvePreviousBlock,
  isContentBlock,
  isCaretAtLogicalStartOfParagraph,
  resolveCurrentBodyParagraph,
  shouldConsumeBackspaceForIndentRemoval,
  applyEffectiveParagraphIndent,
  resolveEffectiveParagraphIndent,
  resolveMergeSemantic,
  resolveMergeWinnerSide,
  resolveProvenMergeSemantic,
  computeMergeContentExpectation,
  verifyMergeContent,
  clearParagraphIndentVisualAndSemantic,
  rehydrateParagraphIndentState,
  type RehydrateContext,
  evaluateRehydrateSafety,
  anchorConfidenceToRehydrateConfidence,
  RehydrateConfidence,
  resolveSafeRehydrateDecision,
  type SafeRehydrateDecision,
  RehydrateMatchStrategy,
  type RehydrateMatchProvenance,
  type CandidateRecord,
  isAfterDisplayMath,
  getUserVisibleParagraphText,
  readParagraphIndentCommand,
  isCaretAtTokenEnd,
  isIndentShortcutEditingToken,
  recordParagraphWrite,
  getLastParagraphWriter,
  getParagraphWriterHistory,
  WriterIds,
  type ParagraphIndentSemanticMode,
  type BackspaceIndentCommandContext,
  type RehydrateResolvedCandidate,
  type RehydrateOwnershipGroup,
  type ParagraphRehydratePlan,
  buildRehydrateOwnershipGroups,
  getElementIdentity,
  type CaretWriteResult,
  type OneShotParagraphReplacementHandoff,
  type EnterCommitSuccessFields,
  type CommandParagraphCaretTarget,
  type ParagraphLocalCaretWriteResult,
  resolveSelectionParagraph,
  type SelectionParagraphResolution,
  type RuntimeParagraphContinuity,
  type PostTokenSelectionResult,
  type CaretRepairResult,
  findCaretBearingTextLeaf,
  writeCaretAtTextLeaf,
  repairCaretAtParagraphLogicalStart,
  type LiveParagraphRecordBinding,
  resolveSelectionTruth,
  type SelectionTruth,
  type CaretExpectation,
  type CaretExpectationReason,
  type CaretVerificationResult,
  verifyCaretExpectation,
  restoreLogicalCaret,
  setPluginSelectionWriteSink,
  type PluginSelectionWriteAuditEntry,
} from './paragraph-indent-manager'
import {
  PostTextInputObservationLifecycle,
  type PostTextInputObservationState,
  type PostTextInputCancelReason,
  type PostTextInputAcceptance,
} from './post-text-input-observation'
import {
  loadParagraphLayout,
  saveParagraphLayout,
  createParagraphAnchor,
  resolveParagraphAnchor,
  updateParagraphAnchor,
  evaluateHistoricalRehydrateIdentity,
  collectContentParagraphs,
  migrateLegacyIndentMarkers,
  injectProductionVaultRoot,
  type ParagraphIndentOverrideRecord,
  type AnchorResolveResult,
} from './paragraph-layout-store'
import {
  ParagraphCanonicalRegistry,
  validatePersistentResolverEligibility,
  validateSingleDotCandidate,
  type CanonicalRuntimeState,
  type CanonicalRuntimeMeta,
  type CanonicalMutationIntent,
  type CandidateSource,
  type CanonicalBindingTransferResult,
  type LiveOwnershipProof,
  type LiveReplacementTicket,
  type ReplacementResolution,
} from './paragraph-canonical-registry'
import {
  activateNormalEnterTrace,
  deactivateNormalEnterTrace,
  getTraceState,
  safeTrace,
  traceT1_AfterNormalEnter,
  traceT2_MutationRecords,
  traceT3_Classifier,
  traceT4_RequestRefresh,
  traceT5_DoRefresh,
  traceT6_Rehydrate,
  traceT7_RefreshStyles,
  traceT8_FinalState,
  identifyElement,
  identifyNode,
  summarizeElement,
  summarizeSelection,
  getComputedIndent,
  type T0Data,
  type T2Record,
  type T6Data,
} from './normal-enter-trace'
import {
  activateForensic,
  deactivateForensic,
  isForensicActive,
  safeForensic,
  captureParagraphState,
  captureParentChain,
  captureSelectionState,
  captureMatchedCSSRules,
  writeForensicEntry,
  FORENSIC_BUILD_MARKER,
} from './paragraph-indent-forensic'
import {
  resolveDocumentRuntimeContext,
  type DocumentRuntimeContext,
  type RuntimeScopeRef,
} from '../runtime/document-runtime-context'
import { emitRuntimeAudit, flushForensicSink } from '../runtime/forensic-log-sink'
import { runEditorInputFocusProbeWithSafety } from '../runtime/editor-input-focus-probe'
import {
  resolveEmptySlot,
  evaluateEmptySpecialFinal,
  isTokenOnlyEmptySpecialCommand,
  snapshotEmptyBlockDom,
  decideEmptySpecialSettle,
  normalizeTokenConsumedEmptyParagraph,
  shouldClearActiveTxn,
  isNativeEmptyParagraph,
  decideEmptyProjectionMode,
  computeEmptyVisualCaretGeometry,
  decideEmptySpecialCommit,
  shouldEmitEmptyNonemptyTransition,
  evaluateEmptyNonemptyProjectionTransition,
  classifyObserverEmptyEquivalent,
  classifyObserverArmReason,
  isEmptyEquivalentParagraph,
  computeCanonicalTransferComputedIndent,
  type EmptySpecialCommandTransaction,
  type EmptyBlockDomSnapshot,
  type EmptySpecialSettleDecisionName,
  type EmptyProjectionMode,
  type EmptyVisualCaretGeometryResult,
  type EmptyNonemptyProjectionBefore,
  type EmptyNonemptyProjectionAfter,
} from './empty-special-command'
import {
  evaluateEmptySpecialTestHook,
  readEmptySpecialTestHookFile,
  writeEmptySpecialTestHookFile,
  isTestVaultRoot,
  isTestVaultPath,
} from './empty-special-test-hook'
import {
  type NormalEnterContinuityTransaction,
  type StructuralDecision,
  type NormalEnterState,
} from './normal-enter-continuity'
import {
  generateDocumentKey,
  deepCloneSettings,
  resolveEffectiveSettings,
  saveHeadingSettings,
  removeDocumentOverride,
  hasDocumentOverride,
  migrateHeadingNumberingToScopeStore,
  getDefaultHeadingNumberingSettings,
  saveLayoutOverrides,
  hasLayoutOverrides,
  resolveHeadingLayoutsForMode,
  resolveParagraphLayoutSettings,
} from './heading-numbering-scope-store'
import { isInkChapterUiEvent } from './plugin-ui-event-guard'
import {
  customFormatRef,
  resolveDocumentFormatBinding,
  resolveGlobalDefaultFormatRef,
  resolveEffectiveFormatId,
} from './document-format-binding'

// ── Enter Indent Transaction ───────────────────────────────

/**
 * R58.7: Immutable canonical transfer provenance snapshot.
 *
 * Built from the KNOWN recordId (NOT a live/disconnected fromElement),
 * while the record is still CURRENT_LIVE and before markAwaitingTransfer.
 * The resolved recordMode is the single source of truth for the projection.
 */
interface CanonicalTransferPlan {
  recordId: string
  recordMode: ParagraphIndentOverrideRecord['mode'] | null
  scopeId: string
  persistenceKey: string | null
  generation: number
  fromRuntimeId: string
  candidateRuntimeId: string
}

/**
 * R58.7: Structured outcome of a canonical transfer, used to gate NORMAL-ENTER-FINAL.
 * overall = semantic && visual && identity — MUST NOT be true when any layer failed.
 */
interface CanonicalContinuityOutcome {
  overall: boolean
  recordId: string | null
  semanticTransfer: boolean
  visualTransfer: boolean
  identityTransfer: boolean
  failReason: string | null
}

interface EnterIndentTransaction {
  id: string
  startedAt: number
  paragraph: HTMLElement
  token: '..' | '。。'
  paragraphCountBefore: number
  state: 'created' | 'token-consumed' | 'semantic-written' | 'visual-applied' | 'caret-restored' | 'committed' | 'closed'
  suppressNativeInsertParagraph: boolean
  semanticWritten: boolean
  sidecarWritten: boolean
  tokenConsumed: boolean
  /** R58.7 Phase A.1.3.1a: Immutable runtime scope snapshot for this transaction. */
  scopeRef: RuntimeScopeRef | null
  traceData: Record<string, unknown>
}

/** P0-B: Mutation-authoritative settle context (observer armed BEFORE token consume). */
interface EmptySpecialSettleContext {
  emptyTxn: EmptySpecialCommandTransaction
  root: HTMLElement | null
  observer: MutationObserver | null
  observerArmedAt: number
  tokenConsumedAt: number
  observerArmedBeforeTokenConsume: boolean
  mutationGeneration: number
  relevantMutationCount: number
  relevantMutationTypes: Set<string>
  sourceConnectedBefore: boolean
  sourceConnectedAfter: boolean
  paragraphCountBefore: number
  version: number
  quietFrames: number
  lastSeenVersion: number
  settled: boolean
  rafId: number | null
  // ARM-time immutable snapshot (captured once, after observer.observe, before token consume).
  observerRootConnectedAtArm: boolean
  observerRootContainsSourceAtArm: boolean
  sourceConnectedAtArm: boolean
  observerRootIsCurrentEditorRoot: boolean
  editorInstanceId: string
}

interface PostCommitObservationSession {
  observationId: string
  txnId: string
  paragraphAtCommit: HTMLElement
  paragraphIdentityAtCommit: string
  startedAt: number
  transactionClosedAt: number
  lastKnownParagraph: HTMLElement | null
  mutationObserver: MutationObserver | null
  traceData: Record<string, unknown>
}

// ── R58.6.7: Merge Batch-First Preflight Types ───────────

interface MergeOwnerSnapshot {
  recordId: string
  runtimeId: string
  generation: number
  element: HTMLElement
  state: CanonicalRuntimeState
  documentKey: string
  semantic: 'auto' | 'force-indent' | 'force-flush'
}

// ── PF4: Boundary merge pre-keydown intent snapshot ───────────────────
// Captured at keydown BEFORE Typora's native DOM mutation. Single-slot,
// short-lived — serves exactly the next boundary Delete/Backspace merge.

interface PendingBoundaryMergeIntent {
  intentId: string
  intentEpoch: number
  key: 'Delete' | 'Backspace'
  direction: 'forward' | 'backward'
  leftElement: HTMLElement
  rightElement: HTMLElement
  leftRuntimeId: string
  rightRuntimeId: string
  leftText: string
  rightText: string
  leftSemantic: ParagraphIndentSemanticMode
  rightSemantic: ParagraphIndentSemanticMode
  leftRecordId: string | null
  rightRecordId: string | null
  leftExplicitProven: boolean
  rightExplicitProven: boolean
  leftOwnershipProofReason: string
  rightOwnershipProofReason: string
  expectedMergedText: string
  expectedCaretOffset: number
  documentKey: string
  scopeId: string
}

type MergeBatchDecision =
  | 'NO_CANONICAL_OWNER'
  | 'TRANSFER_SINGLE_OWNER'
  | 'BLOCK_MULTI_OWNER'
  | 'BLOCK_AMBIGUOUS'

// ── R58.6.7: User Intent Types ──────────────────────────

type UserIntentSource =
  | 'SPECIAL_COMMAND'
  | 'NORMAL_ENTER'
  | 'BACKSPACE'
  | 'DELETE'
  | 'TEXT_INPUT'
  | 'KEYBOARD_NAVIGATION'
  | 'POINTER'

interface UserIntentToken {
  intentId: string
  epoch: number
  source: UserIntentSource
  startedAt: number
  eventType: string
  key?: string
  inputType?: string
  trusted: boolean
}

const INTENT_DEDUP_WINDOW_MS = 50

const TAIL_REFRESH_MS = 60
const FOCUS_TAIL_MS = 50

export interface ServiceContext {
  readonly settings: PluginSettings<InkChapterSettings>
  onWorkspaceEvent: <K extends string>(event: K, listener: (...args: never[]) => void) => () => void
  onEditorEvent: <K extends string>(event: K, listener: (...args: never[]) => void) => () => void
  registerDisposable: (fn: () => void) => void
  /** Optional: get the currently open file path (for document-level overrides). */
  getActiveFilePath?: () => string | null
  /** Optional: get the raw markdown content of the current editor. */
  getMarkdown?: () => string
  /** Optional: replace editor content with undo support. */
  reloadContent?: (markdown: string) => void
  /** Optional: replace editor content preserving undo history (for shortcut commands). */
  reloadContentPreservingUndo?: (markdown: string) => void
  /** Optional: write diagnostic data to a file (for DOM structure debugging). */
  writeDiagnosticFile?: (filename: string, data: string) => void
  /** Optional: get cursor absolute offset via EditorSelection API. */
  getCursorOffset?: () => number | null
  /** Optional: set cursor absolute offset via EditorSelection API. */
  setCursorOffset?: (offset: number) => void
  /** R58.3: Authoritative vault root for sidecar storage. */
  vaultRoot?: string
}

/** Reasons that mandate a force refresh (skip dirty check entirely). */
const FORCE_REFRESH_REASONS: Set<RefreshReason> = new Set([
  'toggle', 'manual', 'initial-load', 'focus-in', 'decoration-repair',
  'file-open', 'active-leaf-change',
])

/**
 * Convert contextual format variants back to multilevel format variants.
 * This keeps the two models in sync for backward compatibility.
 */
function contextualToMultilevelVariants(
  contextual: ContextualFormatVariants,
): MultilevelFormatVariants {
  const convert = (segs: readonly import('./heading-types').ContextualFormatSegment[]): MultilevelFormatSegment[] =>
    segs.map(seg => {
      if (seg.type === 'literal') return { type: 'literal', value: seg.value }
      return { type: 'level-template-reference', level: seg.level }
    })
  return {
    withLevelOne: convert(contextual.withLevelOne),
    withoutLevelOne: convert(contextual.withoutLevelOne),
  }
}

export class HeadingNumberingService {
  private adapter: HeadingDomAdapter
  private store: DisposableStore
  private ctx: ServiceContext

  /** External listeners for settings changes (e.g. settings tab). */
  private settingsListeners: Array<(settings: HeadingNumberingSettings) => void> = []

  // Scheduler
  private rafId: ReturnType<typeof requestAnimationFrame> | null = null
  private tailTimer: ReturnType<typeof setTimeout> | null = null
  private pendingReasons = new Set<RefreshReason>()

  // State
  private lastSnapshot: HeadingSnapshot[] | null = null
  private renderedStates: RenderedHeadingState[] | null = null
  private renderedGaps: string[] | null = null
  private isInComposition = false
  private mutationObserver: MutationObserver | null = null

  // Paragraph command mutation: epoch counter for dedupe
  private paragraphMutationEpoch = 0
  /** Suppress paragraph command detection during plugin-authored reloads. */
  private suppressParagraphCommandDetection = false

  // ── Enter Indent Transaction — single owner, single transaction per Enter ──
  private activeEnterTransaction: EnterIndentTransaction | null = null
  private enterTxnSeq = 0

  // ── R58.7: Normal Enter Continuity Transaction — one per Normal Enter ──
  private activeNormalEnterTxn: NormalEnterContinuityTransaction | null = null
  private normalEnterTxnSeq = 0

  // ── Post-Commit Observation — read-only, independent of transaction lifecycle ──
  // Map-based: each transaction gets its own independent observation to T9.
  // Multiple concurrent observations coexist without overwriting each other.
  private observations = new Map<string, PostCommitObservationSession>()

  // ── P0-5: One-Shot Paragraph Replacement Handoff ────────────────
  // Replaces old PendingLogicalParagraphState (removed r54).
  // Short-lived: resolves replacement once, transfers semantic+visual,
  // never writes caret/sidecar, consumed after first resolution.
  private activeOneShotHandoff: OneShotParagraphReplacementHandoff | null = null

  // ── R58.5: Generic Live Replacement Ticket ────────────────────────
  // Created by MutationObserver when a CURRENT_LIVE bound element is removed.
  // Used for non-Enter DOM replacement continuity.
  private activeLiveReplacementTickets = new Map<string, LiveReplacementTicket>()

  // ── R58.7: Last canonical transfer outcome (gates NORMAL-ENTER-FINAL) ──
  private lastCanonicalContinuityOutcome: CanonicalContinuityOutcome | null = null

  // ── R58.6.5: Active CaretExpectation ───────────────────────────────
  private activeCaretExpectation: CaretExpectation | null = null

  // ── PF4: Boundary merge pre-keydown intent (single-slot, short-lived) ──
  private pendingBoundaryMergeIntent: PendingBoundaryMergeIntent | null = null

  // ── STRICT-FIRST-H1: reactive runtime validation state ──
  private strictFirstH1State: StrictFirstH1RuntimeState | null = null
  private strictFirstH1Signature: string | null = null
  private strictFirstH1Listeners: Array<() => void> = []

  // ── R58.7 Phase A.1: Document Runtime Context (dual gate: business + persistence) ─
  private documentContext: DocumentRuntimeContext = {
    mode: 'NO_EDITOR',
    scopeId: null,
    sessionId: '',
    editorInstanceId: null,
    vaultRoot: null,
    activeFilePath: null,
    persistenceKey: null,
    businessReady: false,
    persistenceReady: false,
    businessReason: 'NO_EDITOR',
    persistenceReason: 'ACTIVE_FILE_MISSING',
  }
  private nextEditorInstanceId = 1

  // ── R58.6.7: User Intent Epoch (editor-wide trusted intent authority) ──
  private userIntentEpoch = 0
  private lastUserIntentKey = ''
  private lastUserIntentSource: UserIntentSource | '' = ''
  private lastUserIntentTime = 0
  private intentSeq = 0
  private compositionTextInputCount = 0
  private compositionDedupedCount = 0
  // ── R58.7 Post-TEXT_INPUT Stability forensic counters (read-only instrumentation) ──
  private pluginSelectionWriteCount = 0
  private caretContinuityRestoreCount = 0
  private caretRepairCount = 0
  private rehydratePlanCount = 0
  private rehydrateApplyCount = 0
  private rehydrateDomWriteCount = 0
  private postTextInputLifecycle = new PostTextInputObservationLifecycle()
  private imeCompositionSessionSeq = 0
  private imeCompositionActiveSessionId = ''
  private imeCompositionStartTs = 0
  private imeLastBeforeInputTs = 0
  private imeLastInputTs = 0
  private imeCompositionEndTs = 0
  private pendingEmptyNonemptyBefore: EmptyNonemptyProjectionBefore | null = null

  /** R58.6.7: Begin a trusted user intent — advances epoch with dedup for keydown+beforeinput pairs. */
  private beginTrustedUserIntent(
    source: UserIntentSource,
    eventType: string,
    key?: string,
    inputType?: string,
  ): UserIntentToken {
    const now = Date.now()
    const deduplicated =
      eventType === 'beforeinput' &&
      this.lastUserIntentKey === (key ?? '') &&
      (now - this.lastUserIntentTime) < INTENT_DEDUP_WINDOW_MS

    if (!deduplicated) {
      this.userIntentEpoch++
    }

    this.intentSeq++
    const token: UserIntentToken = {
      intentId: `intent-${this.intentSeq}-${this.userIntentEpoch}`,
      epoch: this.userIntentEpoch,
      source,
      startedAt: now,
      eventType,
      key,
      inputType,
      trusted: true,
    }

    if (!deduplicated) {
      this.lastUserIntentKey = key ?? ''
      this.lastUserIntentSource = source
      this.lastUserIntentTime = now
    }

    emitRuntimeAudit('USER-INTENT-EPOCH', {
      intentId: token.intentId,
      epoch: token.epoch,
      source,
      eventType,
      key: key ?? 'none',
      inputType: inputType ?? 'none',
      deduplicated,
      trustedUserInput: true,
      previousEpoch: deduplicated ? token.epoch : token.epoch - 1,
      scopeId: this.documentContext.scopeId ?? 'unknown',
      persistenceKey: this.documentContext.persistenceKey ?? 'null',
      documentMode: this.documentContext.mode,
      timestamp: now,
    })

    if (source === 'TEXT_INPUT') {
      console.info(
        `[InkChapter] TEXT-INPUT-INTENT-AUDIT: ` +
        `intentId=${token.intentId} ` +
        `epoch=${token.epoch} ` +
        `eventType=${eventType} ` +
        `inputType=${inputType ?? 'none'} ` +
        `deduplicated=${deduplicated} ` +
        `trusted=true`,
      )
    }

    // ── R58.7 Post-TEXT_INPUT Stability observation (targeted single-shot) ──
    if (!deduplicated) {
      const splitExpectation = this.activeCaretExpectation
      const armingSplitTextInput =
        source === 'TEXT_INPUT' &&
        splitExpectation?.active === true &&
        splitExpectation.reason === 'SPLIT_NEW_PARAGRAPH' &&
        splitExpectation.intentEpoch < token.epoch
      if (armingSplitTextInput && splitExpectation) {
        this.armPostTextInputStabilityObservation(
          token.intentId,
          token.epoch,
          inputType ?? 'insertText',
          splitExpectation.expectationId,
          splitExpectation.intentEpoch,
        )
      } else if (this.postTextInputLifecycle.activeObservation && !this.postTextInputLifecycle.activeObservation.committed) {
        // Self-Check A: same-composition-session insertCompositionText is NOT a new
        // ownership intent — do not cancel the armed observation. Only a genuinely
        // new intent (different composition session / pointer / nav / Enter / etc.) cancels.
        const isSameCompositionContinuation =
          source === 'TEXT_INPUT' &&
          (inputType === 'insertCompositionText' || this.isInComposition)
        if (!isSameCompositionContinuation) {
          this.cancelPostTextInputStabilityObservation('NEW_REAL_INTENT')
        }
      }
    }

    // ── R58.7: Close old NormalEnter txn on new user intent ──
    if (!deduplicated && source !== 'NORMAL_ENTER' && this.activeNormalEnterTxn?.active) {
      this.closeNormalEnterTxn('SUPERSEDED_BY_NEW_USER_INTENT')
    }

    // Supersede old handoff (only when epoch actually advanced)
    if (!deduplicated) {
      // ── R58.7: NORMAL-ENTER-PRE forensic snapshot ──
      if (source === 'NORMAL_ENTER') {
        const root = this.adapter.getEditorRoot()
        const sel = window.getSelection()
        const selPara = sel?.anchorNode
          ? resolveCurrentBodyParagraph(root ?? document.body)
          : null
        const sourceRtId = selPara ? this.getParagraphRuntimeId(selPara) : 'none'
        const allParas = root ? collectContentParagraphs(root) : []
        const sourceOrdinal = selPara ? allParas.indexOf(selPara) : -1
        const prevPara = sourceOrdinal > 0 ? allParas[sourceOrdinal - 1] : null
        const sourceSemantic = selPara ? getParagraphIndentMode(selPara) : 'unknown'
        const sourceComputedIndent = selPara
          ? window.getComputedStyle(selPara).textIndent
          : 'unknown'
        const sourceRecord = selPara ? this.canonicalRegistry.resolveExactLiveRecord(selPara) : null
        const selTruth = root
          ? resolveSelectionTruth(root, (el: object) => this.getParagraphRuntimeId(el as HTMLElement), 'NORMAL-ENTER-PRE')
          : null

        // ── R58.7: Create NormalEnterContinuityTransaction — acquire caret ownership ──
        const normalEnterTxnId = `NENTER-${++this.normalEnterTxnSeq}-${Date.now()}`
        const fromExpectationId = this.activeCaretExpectation?.active
          ? this.activeCaretExpectation.expectationId
          : null
        const fromHandoffId = (this.activeOneShotHandoff && !this.activeOneShotHandoff.consumed)
          ? this.activeOneShotHandoff.handoffId
          : null

        const txn: NormalEnterContinuityTransaction = {
          id: normalEnterTxnId,
          intentId: token.intentId,
          intentEpoch: token.epoch,
          scopeId: this.documentContext.scopeId ?? 'unknown',
          persistenceKey: this.documentContext.persistenceKey,
          createdAt: now,
          active: true,
          sourceElement: selPara!,
          sourceRuntimeId: sourceRtId,
          sourceOrdinal,
          sourceCanonicalRecordId: sourceRecord?.recordId ?? null,
          sourceCanonicalGeneration: sourceRecord?.meta?.generation ?? null,
          sourceSemantic: sourceSemantic as 'auto' | 'force-indent' | 'force-flush',
          sourceComputedIndent,
          preLogicalOffset: selTruth?.logicalOffset ?? null,
          isFirstParagraph: sourceOrdinal === 0,
          previousParagraphRuntimeId: prevPara ? this.getParagraphRuntimeId(prevPara) : null,
          mutationBatchIds: [],
          structuralDecision: 'PENDING',
          removedSourceRuntimeId: null,
          completedOriginalRuntimeId: null,
          caretDestinationRuntimeId: null,
          fromCaretExpectationId: fromExpectationId,
          fromHandoffId: fromHandoffId,
          state: 'CAPTURED_PRE',
        }

        // ── R58.7 Step 1.1: Preconditions before CARET_OWNERSHIP_ACQUIRED ──
        const selectionExists = sel && sel.rangeCount > 0
        const sourceConnected = selPara?.isConnected ?? false
        const selInsideEditor = selTruth?.insideEditor ?? false

        if (!selectionExists || !selInsideEditor || sourceRtId === 'none' || !sourceConnected) {
          this.invalidOwnershipAcquireCount++
          if (!selInsideEditor) this.selectionLossCount++
          if (sourceOrdinal === 0 && (!selectionExists || !selInsideEditor)) this.firstLineFailureCount++
          this.normalEnterFailedCount++
          console.warn(
            `[InkChapter] NORMAL-ENTER-PRECONDITION-FAIL: ` +
            `selectionExists=${selectionExists} ` +
            `selectionInsideEditor=${selInsideEditor} ` +
            `sourceRuntimeId=${sourceRtId} ` +
            `sourceElementConnected=${sourceConnected} ` +
            `isFirstParagraph=${sourceOrdinal === 0} ` +
            `decision=BLOCK`,
          )
          // Do NOT create transaction — return immediately
          return token
        }

        // Acquire caret ownership BEFORE closing old owners
        txn.state = 'CARET_OWNERSHIP_ACQUIRED'
        this.activeNormalEnterTxn = txn

        console.info(
          `[InkChapter] NORMAL-ENTER-CARET-HANDOVER: ` +
          `normalEnterTxnId=${normalEnterTxnId} ` +
          `fromCaretExpectationId=${fromExpectationId ?? 'none'} ` +
          `fromHandoffId=${fromHandoffId ?? 'none'} ` +
          `sourceRuntimeId=${sourceRtId} ` +
          `scopeId=${txn.scopeId} ` +
          `newOwnerState=ACTIVE ` +
          `decision=TAKE_OWNERSHIP`,
        )

        console.info(
          `[InkChapter] NORMAL-ENTER-PRE: ` +
          `normalEnterTxnId=${normalEnterTxnId} ` +
          `intentId=${token.intentId} ` +
          `epoch=${token.epoch} ` +
          `scopeId=${this.documentContext.scopeId ?? 'unknown'} ` +
          `sourceRuntimeId=${sourceRtId} ` +
          `sourceOrdinal=${sourceOrdinal} ` +
          `sourceRecordId=${sourceRecord?.recordId ?? 'none'} ` +
          `sourceSemantic=${sourceSemantic} ` +
          `sourceComputedIndent=${sourceComputedIndent} ` +
          `logicalOffset=${selTruth?.logicalOffset ?? 'null'} ` +
          `isFirstParagraph=${sourceOrdinal === 0} ` +
          `previousParagraphRuntimeId=${prevPara ? this.getParagraphRuntimeId(prevPara) : 'none'} ` +
          `paragraphCount=${allParas.length} ` +
          `hasActiveCaretExpectation=${!!this.activeCaretExpectation?.active} ` +
          `hasActiveHandoff=${!!(this.activeOneShotHandoff && !this.activeOneShotHandoff.consumed)} ` +
          `selectionInsideEditor=${selTruth?.insideEditor ?? false} ` +
          `documentMode=${this.documentContext.mode}`,
        )

        // NOW close old owners — new owner is already ACTIVE
        if (this.activeOneShotHandoff && !this.activeOneShotHandoff.consumed) {
          console.info(
            `[InkChapter] HANDOFF-CLOSE: ` +
            `handoffId=${this.activeOneShotHandoff.handoffId} ` +
            `scopeId=${this.activeOneShotHandoff.scopeId} ` +
            `reason=OWNERSHIP_TRANSFERRED_TO_NORMAL_ENTER ` +
            `handoffEpoch=N/A ` +
            `currentEpoch=${this.userIntentEpoch} ` +
            `decision=CLOSE`,
          )
          this.activeOneShotHandoff = null
        }
        if (this.activeCaretExpectation?.active) {
          console.info(
            `[InkChapter] CARET-EXPECTATION-CLOSE: ` +
            `expectationId=${this.activeCaretExpectation.expectationId} ` +
            `scopeId=${this.activeCaretExpectation.scopeId} ` +
            `reason=OWNERSHIP_TRANSFERRED_TO_NORMAL_ENTER ` +
            `newEpoch=${token.epoch} ` +
            `newSource=${source} ` +
            `restoreAttempted=false`,
          )
          this.activeCaretExpectation.active = false
          this.activeCaretExpectation = null
        }
      } else {
        // Non-NORMAL_ENTER intent: close old owners with standard reason
        if (this.activeOneShotHandoff && !this.activeOneShotHandoff.consumed) {
          console.info(
            `[InkChapter] HANDOFF-CLOSE: ` +
            `handoffId=${this.activeOneShotHandoff.handoffId} ` +
            `scopeId=${this.activeOneShotHandoff.scopeId} ` +
            `reason=SUPERSEDED_BY_USER_INTENT ` +
            `handoffEpoch=N/A ` +
            `currentEpoch=${this.userIntentEpoch} ` +
            `decision=CLOSE`,
          )
          this.activeOneShotHandoff = null
        }
        if (this.activeCaretExpectation?.active) {
          console.info(
            `[InkChapter] CARET-EXPECTATION-CLOSE: ` +
            `expectationId=${this.activeCaretExpectation.expectationId} ` +
            `scopeId=${this.activeCaretExpectation.scopeId} ` +
            `reason=SUPERSEDED_BY_USER_INTENT ` +
            `newEpoch=${token.epoch} ` +
            `newSource=${source} ` +
            `restoreAttempted=false`,
          )
          emitRuntimeAudit('CARET-EXPECTATION-SUPERSESSION-AUDIT', {
            expectationId: this.activeCaretExpectation.expectationId,
            oldEpoch: this.activeCaretExpectation.intentEpoch,
            newEpoch: token.epoch,
            newSource: source,
            restoreAttempted: false,
            superseded: true,
          })
          this.activeCaretExpectation.active = false
          this.activeCaretExpectation = null
        }
      }
    }

    return token
  }

  /** Backward-compat: advance user intent epoch (used by SPECIAL_COMMAND path). */
  private advanceUserIntent(source: string): void {
    this.beginTrustedUserIntent(source as UserIntentSource, 'keydown', 'Enter')
  }

  /** R58.7: Close active NormalEnter transaction. */
  private closeNormalEnterTxn(reason: string): void {
    const txn = this.activeNormalEnterTxn
    if (!txn || !txn.active) return
    txn.active = false
    txn.state = txn.state === 'CARET_VERIFIED' ? 'CLOSED' : 'FAILED'
    txn.closedAt = Date.now()
    txn.closeReason = reason
    this.normalEnterFailedCount++
    if (reason.includes('NEW_USER_INTENT')) {
      this.unexpectedKeyboardNavigationCount++
    }
    console.info(
      `[InkChapter] NORMAL-ENTER-TRANSACTION-CLOSE: ` +
      `normalEnterTxnId=${txn.id} ` +
      `reason=${reason} ` +
      `state=${txn.state} ` +
      `intentEpoch=${txn.intentEpoch} ` +
      `scopeId=${txn.scopeId} ` +
      `decision=CLOSE`,
    )
    this.activeNormalEnterTxn = null
  }

  // ── R58.7 Post-TEXT_INPUT Stability forensic (read-only, no selection/DOM write) ──

  private recordPluginSelectionWrite(
    writeId: string,
    caller: string,
    reason: string,
    runtimeId: string,
    logicalOffsetBefore: number | null,
    logicalOffsetRequested: number | null,
    success: boolean,
  ): void {
    this.pluginSelectionWriteCount++
    if (caller === 'CARET-CONTINUITY-RESTORE') this.caretContinuityRestoreCount++
    if (caller === 'CARET-REPAIR') this.caretRepairCount++
    const root = this.adapter.getEditorRoot()
    const after = root
      ? resolveSelectionTruth(root, (el: object) => this.getParagraphRuntimeId(el as HTMLElement), `WRITE-${caller}`)
      : null
    emitRuntimeAudit('PLUGIN-SELECTION-WRITE-AUDIT', {
      writeId,
      caller,
      reason,
      runtimeId,
      logicalOffsetBefore: logicalOffsetBefore ?? 'null',
      logicalOffsetRequested: logicalOffsetRequested ?? 'null',
      logicalOffsetAfter: after?.logicalOffset ?? 'null',
      intentEpoch: this.userIntentEpoch,
      success,
    })
  }

  private samplePostTextInputStability(
    obs: PostTextInputObservationState,
    generation: number,
    sample: string,
  ): void {
    const scopeId = this.documentContext.scopeId ?? 'unknown'
    const editorInstanceId = this.documentContext.editorInstanceId ?? 'unknown'
    // explicit scope/document change → cancel once (then stale timers no-op)
    if (this.postTextInputLifecycle.activeObservation === obs &&
        obs.generation === generation &&
        obs.scopeId !== scopeId) {
      this.postTextInputLifecycle.markStaleCallbackDropped()
      this.cancelPostTextInputStabilityObservation('SCOPE_CHANGED')
      return
    }
    // callback gate — observationId/generation/scopeId/editorInstanceId
    if (!this.postTextInputLifecycle.isCurrent(obs, generation, scopeId, editorInstanceId)) {
      // stale callback dropped — never reads/writes editor; staleCallbackExecutedCount stays 0
      this.postTextInputLifecycle.markStaleCallbackDropped()
      console.info(
        `[InkChapter] POST-TEXT-INPUT-CALLBACK-GATE: ` +
        `observationId=${obs.observationId} ` +
        `expectedGeneration=${generation} ` +
        `currentGeneration=${this.postTextInputLifecycle.currentGeneration} ` +
        `scopeMatches=${obs.scopeId === scopeId} ` +
        `editorMatches=${obs.editorInstanceId === editorInstanceId} ` +
        `activeMatches=${this.postTextInputLifecycle.activeObservation === obs} ` +
        `decision=DROP_STALE`,
      )
      return
    }
    const root = this.adapter.getEditorRoot()
    const truth = root
      ? resolveSelectionTruth(root, (el: object) => this.getParagraphRuntimeId(el as HTMLElement), `STABILITY-${sample}`)
      : null
    const visibleText = truth?.paragraph ? getUserVisibleParagraphText(truth.paragraph) : ''
    emitRuntimeAudit('POST-TEXT-INPUT-STABILITY', {
      observationId: obs.observationId,
      generation: obs.generation,
      inputIntentId: obs.inputIntentId,
      intentEpoch: obs.intentEpoch,
      source: obs.inputType,
      sample,
      commitAnchor: obs.commitAnchor || 'none',
      runtimeId: truth?.runtimeId ?? 'null',
      visibleText,
      logicalOffset: truth?.logicalOffset ?? 'null',
      insideEditor: truth?.insideEditor ?? false,
      collapsed: truth?.collapsed ?? true,
      anchorConnected: truth?.anchorNodeConnected ?? false,
      focusConnected: truth?.focusNodeConnected ?? false,
      isCompositionActive: this.isInComposition,
      activeCaretExpectationId: this.activeCaretExpectation?.active ? this.activeCaretExpectation.expectationId : 'none',
      activeCaretExpectationEpoch: this.activeCaretExpectation?.active ? this.activeCaretExpectation.intentEpoch : 'none',
      pluginSelectionWriteCountSinceInput: this.pluginSelectionWriteCount - obs.selectionWriteCounterAtInput,
      caretContinuityRestoreCountSinceInput: this.caretContinuityRestoreCount - obs.caretRestoreCounterAtInput,
      caretRepairCountSinceInput: this.caretRepairCount - obs.caretRepairCounterAtInput,
      rehydratePlanCountSinceInput: this.rehydratePlanCount - obs.rehydratePlanCounterAtInput,
      rehydrateApplyCountSinceInput: this.rehydrateApplyCount - obs.rehydrateApplyCounterAtInput,
      rehydrateDomWriteCountSinceInput: this.rehydrateDomWriteCount - obs.rehydrateDomWriteCounterAtInput,
      overallReadSuccess: truth !== null,
    })
  }

  private armPostTextInputStabilityObservation(
    intentId: string,
    epoch: number,
    inputType: string,
    supersededExpectationId: string,
    supersededExpectationEpoch: number,
  ): void {
    const obs = this.postTextInputLifecycle.arm({
      inputIntentId: intentId,
      intentEpoch: epoch,
      inputType,
      scopeId: this.documentContext.scopeId ?? 'unknown',
      editorInstanceId: this.documentContext.editorInstanceId ?? 'unknown',
      compositionSessionId: this.imeCompositionActiveSessionId,
      supersededExpectationId,
      supersededExpectationEpoch,
      selectionWriteCounterAtInput: this.pluginSelectionWriteCount,
      caretRestoreCounterAtInput: this.caretContinuityRestoreCount,
      caretRepairCounterAtInput: this.caretRepairCount,
      rehydratePlanCounterAtInput: this.rehydratePlanCount,
      rehydrateApplyCounterAtInput: this.rehydrateApplyCount,
      rehydrateDomWriteCounterAtInput: this.rehydrateDomWriteCount,
    })
    emitRuntimeAudit('POST-TEXT-INPUT-ARM', {
      observationId: obs.observationId,
      generation: obs.generation,
      inputIntentId: intentId,
      intentEpoch: epoch,
      supersededExpectationId,
      supersededExpectationEpoch,
      scopeId: obs.scopeId,
      editorInstanceId: obs.editorInstanceId,
      compositionSessionId: obs.compositionSessionId || 'none',
      maxActiveObservation: 1,
    })
  }

  private cancelPostTextInputStabilityObservation(reason: PostTextInputCancelReason): void {
    const obs = this.postTextInputLifecycle.activeObservation
    if (!obs) return
    this.postTextInputLifecycle.cancel(reason)
    console.info(
      `[InkChapter] POST-TEXT-INPUT-CANCEL: ` +
      `observationId=${obs.observationId} ` +
      `generation=${obs.generation} ` +
      `reason=${reason} ` +
      `committed=${obs.committed}`,
    )
  }

  private samplePostTextInputInputEvent(): void {
    const obs = this.postTextInputLifecycle.activeObservation
    if (!obs) return
    // foreign input isolation — event composition session must match observation's
    const acceptance: PostTextInputAcceptance = this.postTextInputLifecycle.acceptInputEvent(this.imeCompositionActiveSessionId)
    if (acceptance === 'FOREIGN_BLOCK') {
      console.info(
        `[InkChapter] POST-TEXT-INPUT-FOREIGN-EVENT-BLOCK: ` +
        `observationId=${obs.observationId} ` +
        `observationCompositionSessionId=${obs.compositionSessionId || 'none'} ` +
        `eventCompositionSessionId=${this.imeCompositionActiveSessionId || 'none'} ` +
        `eventIntentEpoch=${this.userIntentEpoch} ` +
        `observationIntentEpoch=${obs.intentEpoch} ` +
        `runtimeId=null ` +
        `decision=IGNORE`,
      )
      return
    }
    this.samplePostTextInputStability(obs, obs.generation, 'T_INPUT_EVENT')
  }

  private commitPostTextInputObservation(anchor: string): void {
    const obs = this.postTextInputLifecycle.activeObservation
    if (!obs) return
    if (!this.postTextInputLifecycle.commit(anchor)) return
    const generation = obs.generation
    // ── TEXT-COMMIT-AUDIT (real commit origin) ──
    const root = this.adapter.getEditorRoot()
    const commitTruth = root
      ? resolveSelectionTruth(root, (el: object) => this.getParagraphRuntimeId(el as HTMLElement), 'TEXT-COMMIT')
      : null
    emitRuntimeAudit('TEXT-COMMIT-AUDIT', {
      observationId: obs.observationId,
      compositionSessionId: obs.compositionSessionId || 'none',
      commitSource: anchor,
      compositionEndTimestamp: this.imeCompositionEndTs || 'none',
      lastInputTimestamp: this.imeLastInputTs || 'none',
      lastBeforeInputTimestamp: this.imeLastBeforeInputTs || 'none',
      runtimeId: commitTruth?.runtimeId ?? 'null',
      visibleText: commitTruth?.paragraph ? getUserVisibleParagraphText(commitTruth.paragraph) : '',
      logicalOffset: commitTruth?.logicalOffset ?? 'null',
    })
    this.samplePostTextInputStability(obs, generation, 'COMMIT+0')
    const offsets = [16, 50, 150, 300, 500, 1000, 2200]
    for (const ms of offsets) {
      this.postTextInputLifecycle.scheduleCallback(obs)
      setTimeout(() => {
        this.postTextInputLifecycle.onCallbackFired(obs)
        this.samplePostTextInputStability(obs, generation, `COMMIT+${ms}`)
        if (ms === 2200) {
          this.completePostTextInputObservation(obs)
        }
      }, ms)
    }
  }

  private completePostTextInputObservation(obs: PostTextInputObservationState): void {
    if (this.postTextInputLifecycle.activeObservation !== obs) return
    const completed = this.postTextInputLifecycle.complete()
    if (!completed) return
    const root = this.adapter.getEditorRoot()
    const finalTruth = root
      ? resolveSelectionTruth(root, (el: object) => this.getParagraphRuntimeId(el as HTMLElement), 'COMPLETE')
      : null
    emitRuntimeAudit('POST-TEXT-INPUT-COMPLETE', {
      observationId: completed.observationId,
      generation: completed.generation,
      scopeId: completed.scopeId,
      editorInstanceId: completed.editorInstanceId,
      compositionSessionId: completed.compositionSessionId || 'none',
      finalSample: 'COMMIT+2200',
      finalRuntimeId: finalTruth?.runtimeId ?? 'null',
      finalVisibleText: finalTruth?.paragraph ? getUserVisibleParagraphText(finalTruth.paragraph) : '',
      finalLogicalOffset: finalTruth?.logicalOffset ?? 'null',
      activeObservationAfterComplete: this.postTextInputLifecycle.activeObservationAfterComplete,
      pendingCallbackCountAfterComplete: completed.pendingCallbackCount,
      decision: 'COMPLETE',
    })
  }

  /** R58.7: Static inventory of every plugin selection write site. */
  private logPluginSelectionWriteInventory(): void {
    const explicitSites = [
      { site: 'writeCaretAtTextLeaf', audited: true },
      { site: 'repairCaretAtParagraphLogicalStart.text-leaf', audited: true },
      { site: 'repairCaretAtParagraphLogicalStart.paragraph-structural', audited: true },
      { site: 'focusParagraphAfterMarkerIndex', audited: true },
      { site: 'placeCaretInParagraph', audited: true },
      { site: 'placeCaretAtParagraphLogicalStart', audited: true },
    ]
    const explicitSelectionWriteSiteCount = explicitSites.length
    const auditedExplicitSelectionWriteSiteCount = explicitSites.filter(s => s.audited).length
    const uncoveredPluginSelectionWriteSite = explicitSites.filter(s => !s.audited).length
    // .focus() sites in settings/toolbar are FOCUS_SIDE_EFFECT_ONLY, not editor selection writers.
    const focusSideEffectSiteCount = 10
    console.info(
      `[InkChapter] PLUGIN-SELECTION-WRITE-INVENTORY: ` +
      `explicitSelectionWriteSiteCount=${explicitSelectionWriteSiteCount} ` +
      `auditedExplicitSelectionWriteSiteCount=${auditedExplicitSelectionWriteSiteCount} ` +
      `focusSideEffectSiteCount=${focusSideEffectSiteCount} ` +
      `uncoveredPluginSelectionWriteSite=${uncoveredPluginSelectionWriteSite} ` +
      `overall=${uncoveredPluginSelectionWriteSite === 0}`,
    )
  }

  /** R58.7 Self-Check A: probe invariant assertion. */
  private logPostTextInputProbeInvariant(): void {
    console.info(
      `[InkChapter] POST-TEXT-INPUT-PROBE-INVARIANT: ` +
      `sameCompositionSessionNonDedupInputCancels=false ` +
      `maxActiveObservation=1 ` +
      `overall=true`,
    )
  }

  /** R58.7: Read-only IME/composition selection timing audit. */
  private auditImeSelection(eventType: string, inputType: string, isComposing: boolean): void {
    const now = Date.now()
    if (eventType === 'compositionstart') this.imeCompositionStartTs = now
    if (eventType === 'beforeinput') this.imeLastBeforeInputTs = now
    if (eventType === 'input') this.imeLastInputTs = now
    if (eventType === 'compositionend') this.imeCompositionEndTs = now
    const root = this.adapter.getEditorRoot()
    const truth = root
      ? resolveSelectionTruth(root, (el: object) => this.getParagraphRuntimeId(el as HTMLElement), `IME-${eventType}`)
      : null
    const visibleText = truth?.paragraph ? getUserVisibleParagraphText(truth.paragraph) : ''
    emitRuntimeAudit('IME-SELECTION-AUDIT', {
      compositionSessionId: this.imeCompositionActiveSessionId || 'none',
      eventType,
      inputType,
      isComposing,
      runtimeId: truth?.runtimeId ?? 'null',
      visibleText,
      logicalOffset: truth?.logicalOffset ?? 'null',
      intentEpoch: this.userIntentEpoch,
      timestamp: now,
    })
    if (eventType === 'compositionend') {
      emitRuntimeAudit('IME-EVENT-ORDER', {
        compositionSessionId: this.imeCompositionActiveSessionId || 'none',
        compositionstartTs: this.imeCompositionStartTs || 'none',
        lastBeforeInputTs: this.imeLastBeforeInputTs || 'none',
        lastInputTs: this.imeLastInputTs || 'none',
        compositionEndTs: this.imeCompositionEndTs || 'none',
      })
    }
  }

  // ── R58.7 Step 1.1: Runtime counters ──
  private normalEnterSuccessCount = 0
  private normalEnterFailedCount = 0
  private invalidOwnershipAcquireCount = 0
  private unexpectedKeyboardNavigationCount = 0
  private selectionLossCount = 0
  private firstLineFailureCount = 0
  private normalEnterTxnCreatedFromNonEnterCount = 0
  private specialCommandCreatedFromNonEnterCount = 0
  private activeEmptySpecialTransaction: EmptySpecialCommandTransaction | null = null
  private activeEmptySpecialSettle: EmptySpecialSettleContext | null = null

  /** R58.7 Step 1.2: Validate that a KeyboardEvent is a real Enter key, not IME Process/Period. */
  private isRealEnterKey(e: KeyboardEvent): boolean {
    return (
      e.type === 'keydown' &&
      e.key === 'Enter' &&
      (e.code === 'Enter' || e.code === 'NumpadEnter') &&
      e.isTrusted === true &&
      e.isComposing === false
    )
  }

  /** R58.7 Step 1.1: Log keyboard event provenance for Arrow key investigation. */
  private logKeyboardProvenance(e: KeyboardEvent, sourceListener: string): void {
    const targetRtId = (e.target instanceof HTMLElement)
      ? this.getParagraphRuntimeId?.(e.target) ?? 'none'
      : 'none'
    emitRuntimeAudit('KEYBOARD-EVENT-PROVENANCE', {
      key: e.key,
      code: e.code,
      isTrusted: e.isTrusted,
      repeat: e.repeat,
      timeStamp: e.timeStamp,
      targetTag: (e.target as Element).tagName ?? 'unknown',
      targetRuntimeId: targetRtId,
      defaultPrevented: e.defaultPrevented,
      eventPhase: e.eventPhase,
      sourceListener,
      activeNormalEnterTxn: this.activeNormalEnterTxn?.id ?? 'none',
    })
  }

  // ── R58.7 Phase A.1.3: Pending Save-As Promotion ────────────
  private pendingPersistencePromotion: {
    promotionId: string
    scopeId: string
    editorInstanceId: string
    source: 'SAVE_AS_COMMAND' | 'CONFIRMED_PERSISTENCE_SIGNAL'
    targetPath: string | null
    createdAt: number
    consumed: boolean
  } | null = null

  /** Refresh the document runtime context from current service state. */
  private refreshDocumentContext(): void {
    // ── Immutable BEFORE snapshot (MUST read before any context mutation) ──
    const beforeMode = this.documentContext?.mode ?? 'NO_EDITOR'
    const beforeScopeId = this.documentContext?.scopeId ?? null
    const beforePersistenceKey = this.documentContext?.persistenceKey ?? null
    const beforeActiveFilePath = this.documentContext?.activeFilePath ?? null

    const vaultRoot = this.ctx.vaultRoot ?? null
    const activeFilePath = this.ctx.getActiveFilePath?.() ?? null
    const documentKey = this.getDocumentKey()
    const sessionId = this.canonicalRegistry.sessionId ?? ''
    const editorRoot = this.adapter.getEditorRoot()
    const editorRootExists = !!editorRoot
    const editorInstanceId = this.getOrCreateEditorInstanceId(editorRoot)
    const existingScopeId = this.documentContext?.scopeId ?? null

    // ── Mutate context ──
    this.documentContext = resolveDocumentRuntimeContext(
      vaultRoot, activeFilePath, documentKey, sessionId,
      editorRootExists, editorInstanceId, existingScopeId,
    )

    const ctx = this.documentContext
    emitRuntimeAudit('DOCUMENT-CONTEXT-STATE', {
      mode: ctx.mode,
      scopeId: ctx.scopeId ?? 'null',
      activeFilePath: ctx.activeFilePath ?? 'null',
      persistenceKey: ctx.persistenceKey ?? 'null',
      businessReady: ctx.businessReady,
      persistenceReady: ctx.persistenceReady,
      businessReason: ctx.businessReason,
      persistenceReason: ctx.persistenceReason,
      sessionId: ctx.sessionId,
    })

    // Transition trace with correct BEFORE snapshot + provenance classification
    if (beforeMode !== ctx.mode || beforeScopeId !== ctx.scopeId) {
      // ── Classify operation based on pending promotion ──
      let reason: string
      let decision: string
      let preserveScope = false

      if (beforeMode === 'NO_EDITOR' && ctx.mode === 'EPHEMERAL') {
        reason = 'EDITOR_ROOT_BOUND'
        decision = 'TRANSITION'
      } else if (beforeMode === 'EPHEMERAL' && ctx.mode === 'PERSISTED') {
        // Check for pending Save-As promotion
        const pending = this.pendingPersistencePromotion
        if (
          pending && !pending.consumed &&
          pending.scopeId === beforeScopeId &&
          pending.editorInstanceId === editorInstanceId
        ) {
          pending.consumed = true
          reason = 'SAVE_AS_PROMOTION'
          decision = 'PROMOTE_PERSISTENCE'
          preserveScope = true
          console.info(
            `[InkChapter] PERSISTENCE-PROMOTION-CONSUME: ` +
            `promotionId=${pending.promotionId} ` +
            `scopeId=${pending.scopeId} ` +
            `targetPath=${pending.targetPath ?? 'null'} ` +
            `decision=MATCH`,
          )
        } else {
          reason = 'DOCUMENT_SWITCH'
          decision = 'SWITCH_DOCUMENT'
          console.info(
            `[InkChapter] PERSISTENCE-PROMOTION-MISS: ` +
            `scopeIdBefore=${beforeScopeId ?? 'null'} ` +
            `afterPath=${activeFilePath ?? 'null'} ` +
            `decision=DOCUMENT_SWITCH`,
          )
        }
        this.pendingPersistencePromotion = null
      } else {
        reason = 'DOCUMENT_SWITCH'
        decision = 'SWITCH_DOCUMENT'
      }

      emitRuntimeAudit('DOCUMENT-CONTEXT-TRANSITION', {
        fromMode: beforeMode,
        toMode: ctx.mode,
        scopeIdBefore: beforeScopeId ?? 'null',
        scopeIdAfter: ctx.scopeId ?? 'null',
        scopeIdSame: ctx.scopeId === beforeScopeId,
        persistenceKeyBefore: beforePersistenceKey ?? 'null',
        persistenceKeyAfter: ctx.persistenceKey ?? 'null',
        activeFilePath: ctx.activeFilePath ?? 'null',
        preserveScope,
        reason,
        decision,
      })
      // Document-switch boundary: force the sink to persist the transition synchronously.
      flushForensicSink()

      // Snapshot audit
      console.info(
        `[InkChapter] DOCUMENT-CONTEXT-SNAPSHOT-AUDIT: ` +
        `beforeMode=${beforeMode} ` +
        `beforeScopeId=${beforeScopeId ?? 'null'} ` +
        `beforePersistenceKey=${beforePersistenceKey ?? 'null'} ` +
        `afterMode=${ctx.mode} ` +
        `afterScopeId=${ctx.scopeId ?? 'null'} ` +
        `afterPersistenceKey=${ctx.persistenceKey ?? 'null'} ` +
        `valid=${!(beforeMode === 'EPHEMERAL' && beforePersistenceKey !== null)}`,
      )
    }

    if (ctx.businessReady) {
      emitRuntimeAudit('DOCUMENT-CONTEXT-READY', {
        mode: ctx.mode,
        scopeId: ctx.scopeId,
        businessReady: true,
        persistenceReady: ctx.persistenceReady,
        decision: 'READY',
      })
      // Business context ready → drive the outline document context now (the
      // outlineController may not yet exist during the very first constructor call).
      if (this.outlineController) {
        this.syncOutlineDocumentContext('document-context-ready')
        // A real business-context transition to READY must also produce the
        // authoritative outline snapshot — otherwise the outline can remain
        // empty until the next heading refresh (pointer/focus/keyboard).
        this.requestRefresh('outline-document-context-ready')
      }
    }
  }

  private getOrCreateEditorInstanceId(editorRoot: HTMLElement | null): string | null {
    if (!editorRoot) return null
    const key = '_inkChapterEditorInstanceId'
    const existing = (editorRoot as any)[key] as string | undefined
    if (existing) return existing
    const id = `editor-${this.nextEditorInstanceId++}`
    ;(editorRoot as any)[key] = id
    return id
  }

  /** R58.7 Phase A.1.1: Bind editor runtime authority — called right after setEditorRoot. */
  private bindEditorRuntime(root: HTMLElement): void {
    const editorInstanceId = this.getOrCreateEditorInstanceId(root)
    console.info(
      `[InkChapter] EDITOR-RUNTIME-BOUND: ` +
      `editorInstanceId=${editorInstanceId} ` +
      `rootConnected=${root.isConnected} ` +
      `rootTag=${root.tagName} ` +
      `timestamp=${Date.now()} ` +
      `decision=BOUND`,
    )
  }

  /** Gate: business context must be ready for live business mutations. */
  private assertBusinessContextReady(caller: string): boolean {
    if (this.documentContext.businessReady) {
      // R58.7 Phase A.1.2: Trace ALLOW for key transaction entries
      const isKeyCaller = caller === 'special-command' || caller === 'backspace' || caller === 'mutation-observer' || caller === 'promotion'
      if (isKeyCaller) {
        console.info(
          `[InkChapter] DOCUMENT-BUSINESS-GATE: ` +
          `caller=${caller} ` +
          `mode=${this.documentContext.mode} ` +
          `scopeId=${this.documentContext.scopeId ?? 'null'} ` +
          `businessReady=true ` +
          `decision=ALLOW`,
        )
      }
      return true
    }
    console.info(
      `[InkChapter] DOCUMENT-BUSINESS-GATE: ` +
      `caller=${caller} ` +
      `mode=${this.documentContext.mode} ` +
      `businessReady=false ` +
      `reason=${this.documentContext.businessReason} ` +
      `decision=NO_OP`,
    )
    return false
  }

  /** Gate: persistence context must be ready for sidecar / rehydrate. */
  private assertPersistenceContextReady(caller: string): boolean {
    if (this.documentContext.persistenceReady) return true
    const mode = this.documentContext.mode
    const decision = mode === 'EPHEMERAL' ? 'SKIP_EPHEMERAL' : 'NO_OP'
    console.info(
      `[InkChapter] DOCUMENT-PERSISTENCE-GATE: ` +
      `caller=${caller} ` +
      `mode=${mode} ` +
      `persistenceReady=false ` +
      `reason=${this.documentContext.persistenceReason} ` +
      `decision=${decision}`,
    )
    return false
  }

  /** DEPRECATED: replaced by ensureBusinessContextCurrent. */
  private assertDocumentContextReady(caller: string): boolean {
    return this.ensureBusinessContextCurrent(caller)
  }

  /**
   * R58.7 Phase A.1.1: Lazy stale-context correction.
   * If businessReady=false but editor root exists, refresh context once.
   * Then re-evaluate the business gate.
   */
  private ensureBusinessContextCurrent(caller: string): boolean {
    if (this.documentContext.businessReady) return true
    // Stale context: check authoritative editor runtime
    const editorRoot = this.adapter.getEditorRoot()
    if (editorRoot && editorRoot.isConnected) {
      console.info(
        `[InkChapter] DOCUMENT-CONTEXT-REFRESH: ` +
        `reason=STALE_CONTEXT_CORRECTION ` +
        `caller=${caller} ` +
        `editorRootExists=true ` +
        `editorInstanceId=${this.getOrCreateEditorInstanceId(editorRoot)} ` +
        `activeFilePath=${this.ctx.getActiveFilePath?.() ?? 'null'} ` +
        `previousMode=${this.documentContext.mode}`,
      )
      this.refreshDocumentContext()
      if (this.documentContext.businessReady) return true
    }
    // Still not ready — log divergence
    console.info(
      `[InkChapter] EDITOR-CONTEXT-DIVERGENCE: ` +
      `source=${caller} ` +
      `editorRuntimeExists=${!!editorRoot} ` +
      `documentMode=${this.documentContext.mode} ` +
      `businessReady=${this.documentContext.businessReady} ` +
      `decision=HARD_STOP`,
    )
    return false
  }

  /** R58.7 Phase A.1.2: Runtime scope context for diagnostic traces. */
  private getScopeContext(): { scopeId: string; persistenceKey: string | null; mode: string } {
    return {
      scopeId: this.documentContext.scopeId ?? 'unknown',
      persistenceKey: this.documentContext.persistenceKey,
      mode: this.documentContext.mode,
    }
  }

  /** R58.7 Phase A.1.3.1: Immutable runtime scope snapshot. Returns null if business not ready. */
  private snapshotRuntimeScope(): RuntimeScopeRef | null {
    const ctx = this.documentContext
    if (!ctx.businessReady || !ctx.scopeId || !ctx.editorInstanceId) {
      console.warn(
        `[InkChapter] RUNTIME-SCOPE-VIOLATION: ` +
        `reason=INVALID_SCOPE_SNAPSHOT ` +
        `businessReady=${ctx.businessReady} ` +
        `scopeId=${ctx.scopeId ?? 'null'} ` +
        `editorInstanceId=${ctx.editorInstanceId ?? 'null'} ` +
        `decision=HARD_STOP`,
      )
      return null
    }
    const scope: RuntimeScopeRef = Object.freeze({
      scopeId: ctx.scopeId,
      persistenceKey: ctx.persistenceKey,
      mode: ctx.mode === 'EPHEMERAL' ? 'EPHEMERAL' : 'PERSISTED',
      sessionId: ctx.sessionId,
      editorInstanceId: ctx.editorInstanceId,
    })
    console.info(
      `[InkChapter] RUNTIME-SCOPE-SNAPSHOT: ` +
      `source=TRANSACTION_START ` +
      `scopeId=${scope.scopeId} ` +
      `persistenceKey=${scope.persistenceKey ?? 'null'} ` +
      `mode=${scope.mode} ` +
      `sessionId=${scope.sessionId} ` +
      `editorInstanceId=${scope.editorInstanceId} ` +
      `valid=true`,
    )
    return scope
  }

  // ── r57: Runtime Paragraph ID ────────────────────────────────────

  // ── r57: Runtime Paragraph ID ────────────────────────────────────
  // WeakMap: same HTMLElement → same runtime ID (object identity).
  // Replacement HTMLElement → new runtime ID. Not affected by class/text change.
  private paragraphRuntimeIds = new WeakMap<object, string>()
  private nextParagraphRuntimeId = 1
  private getParagraphRuntimeId(el: HTMLElement): string {
    const existing = this.paragraphRuntimeIds.get(el)
    if (existing) return existing
    const id = `P-RUNTIME-${this.nextParagraphRuntimeId++}`
    this.paragraphRuntimeIds.set(el, id)
    return id
  }

  /** Read-only runtimeId peek — used by the focus probe; NEVER creates an id. */
  private peekParagraphRuntimeId(el: HTMLElement): string | null {
    return this.paragraphRuntimeIds.get(el) ?? null
  }

  /**
   * PURE OBSERVABILITY: read-only renderer focus probe. Emits
   * EDITOR-INPUT-FOCUS-PROBE + EDITOR-INPUT-FOCUS-PROBE-SAFETY without mutating
   * focus / selection / DOM / canonical state.
   */
  runEditorInputFocusProbe(
    phase: 'BEFORE_ACQUIRE' | 'AFTER_ACQUIRE' | 'BEFORE_INPUT' | 'AFTER_INPUT' | 'ON_DEMAND',
  ): void {
    try {
      runEditorInputFocusProbeWithSafety(phase, {
        editorRoot: this.adapter.getEditorRoot(),
        editorInstanceId: this.documentContext.editorInstanceId,
        peekRuntimeId: (el) => this.peekParagraphRuntimeId(el),
      })
    } catch (e) {
      // fail-open: probe must never break business
      logger.warn('EDITOR-INPUT-FOCUS-PROBE failed:', e)
    }
  }

  // ── R58: Live Binding Helpers ────────────────────────────────────

  /** Create or upsert a live binding from a paragraph element to a sidecar record. */
  private upsertLiveBinding(
    recordId: string,
    txnId: string,
    element: HTMLElement,
    temporary: boolean,
    documentKey: string,
  ): LiveParagraphRecordBinding {
    const runtimeId = this.getParagraphRuntimeId(element)
    const existing = this.liveBindings.get(recordId)
    const binding: LiveParagraphRecordBinding = {
      recordId,
      txnId,
      currentElement: element,
      currentRuntimeId: runtimeId,
      generation: (existing?.generation ?? 0) + 1,
      temporary,
      live: true,
      documentKey,
      createdAt: existing?.createdAt ?? Date.now(),
    }
    this.liveBindings.set(recordId, binding)
    this.elementToBindingRecordId.set(element, recordId)

    // LIVE-BINDING-RESOLUTION trace
    console.info(
      `[InkChapter] LIVE-BINDING-RESOLUTION: recordId=${recordId} ` +
      `runtimeId=${runtimeId} ` +
      `operation=${existing ? 'UPSERT' : 'CREATE'} ` +
      `temporary=${temporary} live=true ` +
      `generation=${binding.generation} ` +
      `documentKey=${documentKey}`,
    )
    return binding
  }

  /** Resolve the live binding for a paragraph element. */
  private resolveLiveBindingByElement(element: HTMLElement): LiveParagraphRecordBinding | null {
    const recordId = this.elementToBindingRecordId.get(element)
    if (!recordId) return null
    const binding = this.liveBindings.get(recordId)
    if (!binding) {
      // Stale weak reference — recordId exists but binding was removed
      return null
    }
    if (!binding.currentElement.isConnected) {
      // Element disconnected — binding may be stale
      return null
    }
    return binding
  }

  /** Resolve a live binding by record ID. */
  private resolveLiveBindingByRecordId(recordId: string): LiveParagraphRecordBinding | null {
    const binding = this.liveBindings.get(recordId)
    if (!binding) return null
    if (!binding.currentElement.isConnected) return null
    return binding
  }

  /** Clear all live bindings for a document (on document switch). */
  private clearLiveBindings(): void {
    this.liveBindings.clear()
  }

  // ── In-memory Override Registry ──────────────────────
  // Mirrors sidecar records but updates immediately (no debounce for reads).
  // Source of truth for rehydration; sidecar is the persistent copy.
  private inMemoryOverrides = new Map<string, ParagraphIndentOverrideRecord[]>()

  // ── R58: Live Paragraph Record Binding Registry ──────────────────
  // Connects live Typora paragraph elements (runtimeId) to canonical sidecar records.
  // Keyed by recordId for direct record lookup.
  // Also maintained: WeakMap<HTMLElement, recordId> for element→record reverse lookup.
  private liveBindings = new Map<string, LiveParagraphRecordBinding>()
  private elementToBindingRecordId = new WeakMap<HTMLElement, string>()

  // ── R58.2: Canonical Registry (authoritative identity source) ─────
  // Replaces ad-hoc liveBindings Maps with structured lifecycle state machine.
  // CanonicalRecordId = 唯一业务身份.
  private canonicalRegistry = new ParagraphCanonicalRegistry()

  // ── Normal Enter Trace (P0 diagnostic, dev only) ────
  // Stores T0 snapshot from the PREVIOUS doRefresh for cross-event comparison.
  private lastTraceSnapshot: T0Data | null = null
  private traceDoRefreshCount = 0

  // Render version: incremented on document switch to cancel stale async ops
  private renderVersion = 0

  // Scope store: authoritative source for heading numbering settings
  private scopeStore: HeadingNumberingScopeStore

  // Current document context: resolved effective settings for active document
  private docContext: DocumentNumberingContext

  // Settings revision: bumped on save to invalidate caches
  private settingsRevision = 0

  // Level Range Enforcer
  private levelRangeEnforcer!: HeadingLevelRangeEnforcer
  private lastEffectiveMaxLevel: HeadingLevel = 6

  // Override Store
  private overrideStore: HeadingOverrideStore | null = null

  // Outline Numbering
  private outlineController: OutlineNumberingController
  // Outline Toolbar
  private outlineToolbar: OutlineToolbarController

  // Editor root binding guard
  private boundEditorRoot: HTMLElement | null = null
  private editorRootDisposables: DisposableStore | null = null

  // Timer handles for cleanup
  private pasteListenerTimer: ReturnType<typeof setTimeout> | null = null
  private fileOpenRetryTimer: ReturnType<typeof setTimeout> | null = null

  // Disposed flag
  private disposed = false

  constructor(ctx: ServiceContext, adapter: HeadingDomAdapter) {
    this.ctx = ctx
    this.adapter = adapter

    // ── R58.7: Route every raw plugin selection write through the unified audit ──
    setPluginSelectionWriteSink((entry: PluginSelectionWriteAuditEntry) => {
      this.recordPluginSelectionWrite(
        entry.writeId,
        entry.caller,
        entry.reason,
        entry.runtimeId,
        entry.logicalOffsetBefore,
        entry.logicalOffsetRequested,
        entry.success,
      )
    })
    this.logPluginSelectionWriteInventory()
    this.logPostTextInputProbeInvariant()

    // ── P0-1: Inject production vault root ──────────────────────────
    // Must happen before any sidecar load/write.
    this.injectVaultRoot()

    // ── R58.7 Phase A: Initialize document context ──
    this.refreshDocumentContext()

    // Initialize scope store (with migration from old format)
    this.scopeStore = this.initScopeStore()

    // Resolve effective settings for current document
    const docKey = this.getDocumentKey()
    this.docContext = resolveEffectiveSettings(this.scopeStore, docKey, this.getFormatLibrary())

    // Build enforcer callbacks
    const enforcerCallbacks: EnforcerCallbacks = {
      getEffectiveMaxLevel: () => this.getEffectiveMaxLevel(),
      getMarkdown: () => this.ctx.getMarkdown?.() ?? '',
      reloadContent: (md: string) => this.ctx.reloadContent?.(md),
      showNotice: (msg: string) => Notice.info(msg),
    }
    this.levelRangeEnforcer = new HeadingLevelRangeEnforcer(enforcerCallbacks)
    this.lastEffectiveMaxLevel = this.getEffectiveMaxLevel()

    // Outline numbering controller
    console.info(
      `[InkChapter Numbering] OUTLINE-CODEPATH-MARKER site=SERVICE_CONTROLLER_CREATE ` +
      `controllerImplExpected=outline-controller-late-bind-v26-A`,
    )
    this.outlineController = new OutlineNumberingController()
    this.outlineController.start()

    // Outline toolbar controller
    const toolbarCallbacks: OutlineToolbarCallbacks = {
      isNumberingEnabled: () => this.s.enabled,
      toggleNumbering: () => this.toggleNumberingFromToolbar(),
      isShowLevelOne: () => {
        const structure = resolveHeadingStructure(this.s)
        return structure.showLevelOneNumber
      },
      toggleLevelOneNumber: () => this.toggleLevelOneFromToolbar(),
      writeDiagnosticFile: (filename, data) => {
        this.ctx.writeDiagnosticFile?.(filename, data)
      },
      getHeadings: () => this.outlineController.getCachedHeadings(),
    }
    this.outlineToolbar = new OutlineToolbarController(toolbarCallbacks)
    this.outlineToolbar.start()

    // ── Startup catch-up: the markdown editor may already be loaded (its `load`
    // event fired before plugin onload registered the listener). Bind the
    // outline document context now, before the initial heading refresh.
    this.syncOutlineDocumentContext('startup-catch-up')

    this.store = new DisposableStore()

    this.initAdapter()
    this.setupMutationObserver()
    this.registerEvents()
    this.registerSettingsListener()
    this.requestRefresh('initial-load')

    // ── PURE OBSERVABILITY: expose the read-only renderer focus probe to the
    // harness / DevTools. Trigger emits EDITOR-INPUT-FOCUS-PROBE (the snapshot)
    // into the forensic audit stream; it never mutates focus/selection/DOM.
    try {
      ;(window as any).__inkchapter_probe_editor_input_focus__ = (phase: string) => {
        this.runEditorInputFocusProbe(phase as any)
      }
      ;(window as any).__inkchapter_format_sync_probe__ = () => this.formatSyncProbe()
      ;(window as any).__inkchapter_outline_sync_probe__ = () => ({
        authoritativeDocumentKey: this.getDocumentKey() ?? null,
        activeFilePath: this.getActiveFilePath() ?? null,
        toolbarDocumentKey: this.outlineToolbar.getDocumentKey(),
        ...this.outlineController.getSyncProbe(),
      })
      registerOutlineClickForensic()
    } catch { /* ignore */ }
  }

  /** Initialize scope store: try reading new format, fall back to migration. */
  private initScopeStore(): HeadingNumberingScopeStore {
    const raw = this.ctx.settings.get('headingNumberingScopes' as any) as any
    if (raw?.schemaVersion && raw.globalDefault) {
      logger.info('Using headingNumberingScopes')
      return raw as HeadingNumberingScopeStore
    }

    // Try migration from old headingNumbering
    // Access plugin raw data via settings.get on the legacy key
    const oldSettings = this.ctx.settings.get('headingNumbering' as any) as any
    if (oldSettings?.preset || oldSettings?.levels) {
      const migResult = migrateHeadingNumberingToScopeStore(
        { headingNumbering: oldSettings },
      )
      if (migResult.migrated) {
        logger.info('Migrated headingNumbering → headingNumberingScopes')
        this.persistScopeStore(migResult.store)
      }
      return migResult.store
    }

    // No existing data — use fresh default store
    logger.info('No existing heading numbering data, using defaults')
    return {
      schemaVersion: 1,
      globalDefault: getDefaultHeadingNumberingSettings(),
      documentOverrides: {},
      globalParagraphLayout: { defaultIndent: 'flush', flushAfterDisplayMath: true, indentShortcutEnabled: true },
    }
  }

  /** Persist the scope store to plugin settings. */
  private persistScopeStore(store: HeadingNumberingScopeStore): void {
    this.scopeStore = store
    this.ctx.settings.set('headingNumberingScopes' as any, store as any)
  }

  /** Get the current scope store (for settings tab read). */
  getScopeStore(): HeadingNumberingScopeStore {
    return this.scopeStore
  }

  /** Get the current effective settings (for settings tab read). */
  getEffectiveSettings(): HeadingNumberingSettings {
    return deepCloneSettings(this.docContext.effectiveSettings)
  }

  /** Get current settings source ('global' or 'document'). */
  getSettingsSource(): 'global' | 'document' {
    return this.docContext.source
  }

  /** Save heading numbering with explicit scope. */
  saveHeadingNumberingScoped(
    scope: HeadingSettingsScope,
    documentKey: string | null,
    settings: HeadingNumberingSettings,
    formatSource?: NumberingFormatSource,
  ): void {
    const req: SaveHeadingSettingsRequest = {
      scope,
      documentKey,
      settings,
    }
    if (formatSource) {
      req.formatSource = formatSource
    }
    const newStore = saveHeadingSettings(this.scopeStore, req)
    this.persistScopeStore(newStore)
    this.settingsRevision++

    // Reload document context if current document is affected
    const currentKey = this.getDocumentKey()
    if (scope === 'global' || documentKey === currentKey) {
      const wasEnabled = this.docContext.effectiveSettings.enabled
      this.docContext = resolveEffectiveSettings(this.scopeStore, currentKey, this.getFormatLibrary())
      this.docContext.settingsRevision = this.settingsRevision
      this.lastSnapshot = null
      this.renderedStates = null
      this.outlineToolbar.updateAllButtonStates()
      // When numbering was turned off, doRefresh returns early.
      // Must explicitly clear body and outline numbering.
      if (wasEnabled && !this.s.enabled) {
        this.adapter.clearNumbering()
        this.outlineController.clearOutlineNumbering()
      }
      this.flushRefresh()
    }
  }

  /** Remove document override and restore inherit global. */
  restoreInheritGlobal(documentKey: string): void {
    const newStore = removeDocumentOverride(this.scopeStore, documentKey)
    this.persistScopeStore(newStore)
    this.settingsRevision++

    // Reload current document context
    const currentKey = this.getDocumentKey()
    if (currentKey === documentKey) {
      const wasEnabled = this.docContext.effectiveSettings.enabled
      this.docContext = resolveEffectiveSettings(this.scopeStore, currentKey, this.getFormatLibrary())
      this.docContext.settingsRevision = this.settingsRevision
      this.lastSnapshot = null
      this.renderedStates = null
      this.outlineToolbar.updateAllButtonStates()
      if (wasEnabled && !this.s.enabled) {
        this.adapter.clearNumbering()
        this.outlineController.clearOutlineNumbering()
      }
      this.flushRefresh()
    }
  }

  /** Check if current document has a custom override. */
  hasCurrentDocumentOverride(): boolean {
    return hasDocumentOverride(this.scopeStore, this.getDocumentKey())
  }

  /** Check if current document has any layout overrides (alignment, indent, gap). */
  hasDocumentLayoutOverrides(): boolean {
    return hasLayoutOverrides(this.scopeStore, this.getDocumentKey())
  }

  // ── Format version sync ──────────────────────────

  /** Sync the applied format version in the document override to match the library version. */
  syncDocumentFormatVersion(docKey: string, formatId: string, newVersion: number): void {
    const override = this.scopeStore.documentOverrides[docKey]
    const docSource = override?.formatSource
    if (!docSource || docSource.type !== 'custom' || docSource.formatId !== formatId) return

    this.scopeStore = {
      ...this.scopeStore,
      documentOverrides: {
        ...this.scopeStore.documentOverrides,
        [docKey]: {
          ...override,
          updatedAt: Date.now(),
          formatSource: {
            type: 'custom' as const,
            formatId: docSource.formatId,
            version: newVersion,
          },
        },
      },
    }
    this.persistScopeStore(this.scopeStore)
  }

  /** Sync the global default applied format version to match the library version. */
  syncGlobalDefaultFormatVersion(formatId: string, newVersion: number): void {
    const gSource = (this.scopeStore.globalDefault as any).formatSource as import('./heading-types').NumberingFormatSource | undefined
    if (!gSource || gSource.type !== 'custom' || gSource.formatId !== formatId) return

    this.scopeStore = {
      ...this.scopeStore,
      globalDefault: {
        ...this.scopeStore.globalDefault,
        formatSource: {
          type: 'custom' as const,
          formatId: gSource.formatId,
          version: newVersion,
        },
      } as any,
    }
    this.persistScopeStore(this.scopeStore)
  }

  // ── Paragraph layout ─────────────────────────────

  /** Get the effective paragraph layout settings for the current document. */
  getParagraphLayoutSettings(): import('./heading-types').ParagraphLayoutSettings {
    return resolveParagraphLayoutSettings(this.scopeStore, this.getDocumentKey())
  }

  /** Save paragraph layout settings. */
  saveParagraphLayoutSettings(
    scope: 'global' | 'document',
    settings: import('./heading-types').ParagraphLayoutSettings,
  ): void {
    if (scope === 'global') {
      this.scopeStore = {
        ...this.scopeStore,
        globalParagraphLayout: { ...settings },
      }
    } else {
      const docKey = this.getDocumentKey()
      if (!docKey) return
      const existing = this.scopeStore.documentOverrides[docKey]
      this.scopeStore = {
        ...this.scopeStore,
        documentOverrides: {
          ...this.scopeStore.documentOverrides,
          [docKey]: {
            updatedAt: Date.now(),
            settings: existing?.settings ?? this.scopeStore.globalDefault,
            formatSource: existing?.formatSource,
            layoutOverrides: existing?.layoutOverrides,
            paragraphLayout: { ...settings },
          },
        },
      }
    }
    this.persistScopeStore(this.scopeStore)
    this.flushRefresh()
  }

  /** Restore paragraph layout to inherit global default. */
  restoreParagraphLayoutInheritance(): void {
    const docKey = this.getDocumentKey()
    if (!docKey) return
    const existing = this.scopeStore.documentOverrides[docKey]
    if (!existing) return

    const { paragraphLayout: _, ...rest } = existing
    if (Object.keys(rest).length <= 2) {
      // Only settings/formatSource remain — remove entire override
      this.scopeStore = removeDocumentOverride(this.scopeStore, docKey)
    } else {
      this.scopeStore = {
        ...this.scopeStore,
        documentOverrides: {
          ...this.scopeStore.documentOverrides,
          [docKey]: rest as import('./heading-types').HeadingNumberingDocumentOverride,
        },
      }
    }
    this.persistScopeStore(this.scopeStore)
    this.flushRefresh()
  }

  // ── Template update acknowledgement ──────────────

  /**
   * Get the last acknowledged template version for a document+format pair.
   * Returns undefined if never acknowledged.
   */
  getAcknowledgedTemplateVersion(docKey: string | null, formatId: string): number | undefined {
    if (!docKey) return undefined
    const acks = this.loadAcknowledgements()
    const ackKey = `${docKey}::${formatId}`
    return acks[ackKey]
  }

  /**
   * Record that the user has acknowledged a template update for this document+format+version.
   */
  acknowledgeTemplateUpdate(docKey: string | null, formatId: string, templateVersion: number): void {
    if (!docKey) return
    const acks = this.loadAcknowledgements()
    const ackKey = `${docKey}::${formatId}`
    acks[ackKey] = templateVersion
    this.ctx.settings.set('acknowledgedTemplateUpdates' as any, acks as any)
  }

  /** Load all acknowledged template update records. */
  private loadAcknowledgements(): Record<string, number> {
    const raw = this.ctx.settings.get('acknowledgedTemplateUpdates' as any) as Record<string, number> | undefined
    return raw ?? {}
  }

  /**
   * Check whether a template update notice is still pending (not yet acknowledged).
   * Returns true only when the template version was never acknowledged for this doc+format.
   */
  isTemplateUpdatePending(docKey: string | null, formatId: string, templateVersion: number): boolean {
    const ack = this.getAcknowledgedTemplateVersion(docKey, formatId)
    if (ack === undefined) return true  // never acknowledged
    return ack < templateVersion  // new version, not yet acknowledged
  }

  // ── Format library ───────────────────────────────

  /** Get the user-managed format library from plugin settings. */
  getFormatLibrary(): FormatLibrary {
    const raw = this.ctx.settings.get('formatLibrary' as any) as FormatLibrary | undefined
    if (raw?.version && Array.isArray(raw.formats)) {
      // If the raw data lacks preferences, add defaults (inline migration)
      if (!raw.preferences) {
        return {
          version: raw.version,
          formats: raw.formats,
          preferences: {
            hiddenBuiltInPresetIds: [],
            customFormatOrder: raw.formats.map(f => f.id),
          },
        }
      }
      // Sanitize hidden preset IDs
      const validIds = new Set(['decimal-hierarchical', 'chinese-chapter', 'chinese-outline', 'roman-hierarchical'])
      const sanitized: string[] = []
      const seen = new Set<string>()
      for (const id of raw.preferences.hiddenBuiltInPresetIds ?? []) {
        if (validIds.has(id) && !seen.has(id)) {
          sanitized.push(id)
          seen.add(id)
        }
      }
      return {
        ...raw,
        preferences: {
          hiddenBuiltInPresetIds: sanitized as any,
          customFormatOrder: raw.preferences.customFormatOrder ?? raw.formats.map(f => f.id),
        },
      }
    }
    return { version: 1, formats: [], preferences: { hiddenBuiltInPresetIds: [], customFormatOrder: [] } }
  }

  /** Save the format library to plugin settings. */
  saveFormatLibrary(library: FormatLibrary): void {
    this.ctx.settings.set('formatLibrary' as any, library as any)
  }

  /**
   * Notify that a library format definition changed (created/updated).
   * The active document's effective settings are re-resolved from the library
   * LATEST definition (never the stale applied snapshot), then runtime + outline
   * refresh — with NO format/document/reopen/restart switch required.
   * Unrelated format changes are skipped to avoid pointless refreshes.
   */
  notifyFormatLibraryChanged(formatId: string): void {
    const library = this.getFormatLibrary()
    const latest = library.formats.find(f => f.id === formatId)
    const newVersion = latest?.version ?? 0

    // Keep persisted formatSource.version consistent (informational only — the
    // effective settings now resolve the latest definition dynamically).
    this.syncGlobalDefaultFormatVersion(formatId, newVersion)
    for (const docKey of Object.keys(this.scopeStore.documentOverrides)) {
      const ov = this.scopeStore.documentOverrides[docKey]
      if (ov.formatSource?.type === 'custom' && ov.formatSource.formatId === formatId) {
        this.syncDocumentFormatVersion(docKey, formatId, newVersion)
      }
    }

    const currentKey = this.getDocumentKey()
    const binding = resolveDocumentFormatBinding(this.scopeStore, currentKey)
    const globalRef = resolveGlobalDefaultFormatRef(this.scopeStore)
    const effectiveRef = resolveEffectiveFormatId(binding, globalRef)
    const changedRef = customFormatRef(formatId)

    if (effectiveRef !== changedRef) {
      console.info(
        `[InkChapter] FORMAT-RUNTIME-APPLY formatId=${formatId} decision=SKIP reason=UNRELATED_FORMAT ` +
        `effectiveRef=${effectiveRef} changedRef=${changedRef}`,
      )
      return
    }

    this.docContext = resolveEffectiveSettings(this.scopeStore, currentKey, library)
    this.docContext.settingsRevision = this.settingsRevision
    this.lastSnapshot = null
    this.renderedStates = null
    this.outlineToolbar.updateAllButtonStates()
    this.flushRefresh()
    console.info(
      `[InkChapter] FORMAT-RUNTIME-APPLY formatId=${formatId} version=${newVersion} ` +
      `documentKey=${currentKey ?? 'none'} decision=APPLIED reason=FORMAT_LIBRARY_UPDATED`,
    )
  }

  /**
   * Diagnostic probe exposing the live-reference sync state, so stale
   * `library version=8 / effective version=5 / runtime version=5` mismatches
   * are directly visible. Editor/card fields are filled by the settings tab.
   */
  formatSyncProbe(): Record<string, unknown> {
    const store = this.scopeStore
    const docKey = this.getDocumentKey()
    const binding = resolveDocumentFormatBinding(store, docKey)
    const globalRef = resolveGlobalDefaultFormatRef(store)
    const effectiveRef = resolveEffectiveFormatId(binding, globalRef)
    const library = this.getFormatLibrary()

    const refFormatId = (ref: string): string | null =>
      ref.startsWith('format:') ? ref.slice('format:'.length) : null
    const effectiveFormatId = refFormatId(effectiveRef)
    const libraryLatest = effectiveFormatId
      ? library.formats.find(f => f.id === effectiveFormatId) ?? null
      : null

    const gSource = (store.globalDefault as any).formatSource as NumberingFormatSource | undefined
    const docSource = docKey ? store.documentOverrides[docKey]?.formatSource : undefined
    const persistedVersion = binding.mode === 'override'
      ? (docSource?.type === 'custom' ? docSource.version ?? null : null)
      : (gSource?.type === 'custom' ? gSource.version ?? null : null)

    return {
      activeDocument: this.ctx.getActiveFilePath?.() ?? docKey ?? null,
      globalDefault: {
        formatRef: globalRef,
        snapshotVersion: gSource?.type === 'custom' ? gSource.version ?? null : null,
      },
      documentBinding: binding,
      effective: {
        formatId: effectiveFormatId,
        formatVersion: libraryLatest?.version ?? null,
        source: binding.mode === 'override' ? 'document-override' : 'global-default',
      },
      library: {
        formatId: effectiveFormatId,
        latestVersion: libraryLatest?.version ?? null,
      },
      runtime: {
        appliedFormatId: effectiveFormatId,
        appliedVersion: persistedVersion,
      },
      editor: { editingFormatId: null, draftDirty: null, baselineVersion: null },
      card: { previewFormatId: effectiveFormatId, previewVersion: libraryLatest?.version ?? null },
    }
  }

  /**
   * Apply a format to the specified scope.
   * Deep-clones the format's settings into a snapshot in the scope store.
   * Editing or deleting the format later does NOT affect the snapshot.
   * Preserves existing document-level layout overrides.
   */
  applyFormatToScope(
    format: CustomNumberingFormat,
    scope: HeadingSettingsScope,
    documentKey: string | null,
  ): void {
    // Preserve the current scope's structure mode — format must not change it
    const currentMode = this.resolveScopeStructureMode(scope, documentKey)

    const snapshot: HeadingNumberingSettings = {
      enabled: format.settings.enabled,
      headingStructureMode: currentMode,
      showLevelOneNumber: currentMode === 'loose',
      preset: 'custom',
      maxDepth: format.settings.maxDepth,
      levels: format.settings.levels,
      customDefinition: format.settings.levels,
    }
    const formatSource: NumberingFormatSource = { type: 'custom', formatId: format.id, version: format.version ?? 1 }

    // Preserve existing layout overrides when re-applying format to document scope
    const existingLo = documentKey
      ? this.scopeStore.documentOverrides[documentKey]?.layoutOverrides
      : undefined

    // Save the settings with formatSource first
    this.saveHeadingNumberingScoped(scope, documentKey, snapshot, formatSource)

    // If document had layout overrides, restore them after the format re-apply
    if (existingLo && documentKey) {
      const newStore = saveLayoutOverrides(this.scopeStore, documentKey, existingLo)
      this.persistScopeStore(newStore)
    }

    // Reload document context if current document is affected
    const currentKey = this.getDocumentKey()
    if (scope === 'global' || documentKey === currentKey) {
      this.docContext = resolveEffectiveSettings(this.scopeStore, currentKey, this.getFormatLibrary())
      this.docContext.settingsRevision = this.settingsRevision
      this.lastSnapshot = null
      this.renderedStates = null
      this.outlineToolbar.updateAllButtonStates()
      this.flushRefresh()
    }
  }

  /**
   * Apply a built-in preset to the specified scope.
   */
  applyPresetToScope(
    presetId: string,
    scope: HeadingSettingsScope,
    documentKey: string | null,
  ): void {
    // Preserve the current scope's structure mode — preset must not change it
    const currentMode = this.resolveScopeStructureMode(scope, documentKey)

    const levels = getPresetLevels(presetId as HeadingNumberingPreset)
    const snapshot: HeadingNumberingSettings = {
      enabled: true,
      headingStructureMode: currentMode,
      showLevelOneNumber: currentMode === 'loose',
      preset: presetId as HeadingNumberingPreset,
      maxDepth: 6,
      levels,
      customDefinition: levels,
    }
    const formatSource: NumberingFormatSource = { type: 'built-in', presetId }
    this.saveHeadingNumberingScoped(scope, documentKey, snapshot, formatSource)
  }

  /** Resolve the effective structure mode for a given scope. */
  private resolveScopeStructureMode(
    scope: HeadingSettingsScope,
    documentKey: string | null,
  ): import('./heading-structure').HeadingStructureMode {
    if (scope === 'document' && documentKey) {
      const override = this.scopeStore.documentOverrides[documentKey]
      if (override?.settings.headingStructureMode) {
        return override.settings.headingStructureMode
      }
    }
    return this.scopeStore.globalDefault.headingStructureMode ?? 'strict'
  }

  // ── Convenience accessor for effective settings ──
  private get s(): HeadingNumberingSettings {
    return this.docContext.effectiveSettings
  }

  /** Generate vault-relative document key for the current file. */
  /** Inject production vault root before any sidecar operation. */
  private injectVaultRoot(): void {
    try {
      // R58.3: Use authoritative vault root from ServiceContext (set by main.ts)
      const vaultCandidate = this.ctx.vaultRoot

      if (typeof vaultCandidate === 'string' && vaultCandidate.length > 0) {
        injectProductionVaultRoot(vaultCandidate)
        logger.info(`SIDECAR-CONTEXT: vaultRoot=${vaultCandidate} source=service-context`)
        return
      }

      // Fallback: derive from active file path by searching for .typora ancestor
      const filePath = this.ctx.getActiveFilePath?.()
      if (!filePath) {
        logger.warn('SIDECAR-CONTEXT: vaultRoot unknown — no active file and no context vaultRoot')
        return
      }

      const { dirname, join } = require('path') as typeof import('path')
      const { existsSync } = require('fs') as typeof import('fs')
      let dir = dirname(filePath)
      for (let i = 0; i < 5; i++) {
        if (existsSync(join(dir, '.typora'))) {
          injectProductionVaultRoot(dir)
          logger.info(`SIDECAR-CONTEXT: vaultRoot=${dir} storageRoot=${join(dir, '.typora', 'inkchapter', 'paragraph-layout')} source=derived-from-active-file`)
          return
        }
        const parent = dirname(dir)
        if (parent === dir) break
        dir = parent
      }

      logger.warn(`SIDECAR-CONTEXT: vaultRoot unknown — could not derive from filePath=${filePath}`)
    } catch (e) {
      logger.warn('SIDECAR-CONTEXT: vault root injection failed:', e)
    }
  }

  getDocumentKey(): string | null {
    const filePath = this.ctx.getActiveFilePath?.() ?? null
    if (!filePath) return null
    // Use the vault root from service context
    const vaultRoot = this.ctx.vaultRoot ??
      (filePath.split(/[\\/]/).slice(0, -1).join('/'))
    return generateDocumentKey(filePath, typeof vaultRoot === 'string' ? vaultRoot : filePath.split(/[\\/]/).slice(0, -1).join('/'))
  }

  /**
   * Single authoritative entry point: drive the OutlineController + Toolbar
   * documentKey from the current Document Runtime Context. Called at startup
   * catch-up, DOCUMENT-CONTEXT-READY, editor-load, file-open, and document
   * switch — never rely solely on a possibly-already-fired `load` event.
   */
  private syncOutlineDocumentContext(reason: string): void {
    const authoritativeKey = this.getDocumentKey()
    const businessReady = this.documentContext?.businessReady ?? false

    // Startup catch-up must only bind editor/root infrastructure; a formal
    // document bind is deferred until DOCUMENT-CONTEXT-READY (businessReady=true).
    // Otherwise startup produces a premature bind with businessReady=false and
    // can emit stale SKIP_STALE_TASK/DOCUMENT_KEY_MISMATCH renders.
    if (reason === 'startup-catch-up' && !businessReady) {
      console.info(
        `[InkChapter Numbering] OUTLINE-DOCUMENT-CONTEXT-SYNC reason=${reason} ` +
        `authoritativeKey=${authoritativeKey ?? 'none'} businessReady=${businessReady} decision=DEFER`,
      )
      return
    }

    this.outlineController.syncDocumentContext(authoritativeKey, reason)
    this.outlineToolbar.setDocumentKey(authoritativeKey ?? '')
    console.info(
      `[InkChapter Numbering] OUTLINE-DOCUMENT-CONTEXT-SYNC reason=${reason} ` +
      `authoritativeKey=${authoritativeKey ?? 'none'} businessReady=${businessReady} ` +
      `toolbarKey=${this.outlineToolbar.getDocumentKey() || 'none'}`,
    )
  }

  /** R58.7 Phase A.1: Scope-aware key for in-memory operations (EPHEMERAL uses scopeId, PERSISTED uses documentKey). */
  getScopeKey(): string {
    return this.documentContext.scopeId ?? this.getDocumentKey() ?? 'unknown'
  }

  /** Get the path of the currently active file, or null if none. */
  getActiveFilePath(): string | null {
    return this.ctx.getActiveFilePath?.() ?? null
  }

  /** Get a short document key for audit logging. */
  private getDocKey(): string {
    return this.getActiveFilePath()?.split(/[\\/]/).slice(-1)[0]?.slice(0, 30) ?? 'unknown'
  }

  /** Load document context when switching documents. */
  private loadDocumentContext(): void {
    const oldKey = this.docContext?.documentKey ?? null
    const docKey = this.getDocumentKey()
    this.docContext = resolveEffectiveSettings(this.scopeStore, docKey, this.getFormatLibrary())
    this.docContext.settingsRevision = this.settingsRevision
    // [Diagnostic] Document change log — remove after verification
    const docPath = this.getActiveFilePath()
    const override = docKey ? this.scopeStore.documentOverrides[docKey] : undefined
    const fs = override?.formatSource
    console.log('[InkChapter ServiceDocSwitch] path=' + (docPath ?? '(none)')
      + ' oldKey=' + (oldKey ?? '(none)')
      + ' newKey=' + (docKey ?? '(none)')
      + ' formatSource=' + JSON.stringify(fs ?? null)
      + ' preset=' + this.s.preset
      + ' showLevelOne=' + this.s.showLevelOneNumber)
    // Notify document change listeners when document key changes
    if (docKey !== oldKey) {
      this.notifyDocumentChanged(docKey, oldKey)
    }
  }

  private documentChangeListeners: Array<(newKey: string | null, oldKey: string | null) => void> = []

  /** Subscribe to document changes (file switch). Returns unsubscribe function. */
  onDocumentChanged(listener: (newKey: string | null, oldKey: string | null) => void): () => void {
    this.documentChangeListeners.push(listener)
    return () => {
      const idx = this.documentChangeListeners.indexOf(listener)
      if (idx >= 0) this.documentChangeListeners.splice(idx, 1)
    }
  }

  private notifyDocumentChanged(newKey: string | null, oldKey: string | null): void {
    for (const listener of this.documentChangeListeners) {
      try { listener(newKey, oldKey) } catch (e) { logger.error('文档切换监听器异常', e) }
    }
  }

  toggle(): void {
    const s = this.s
    s.enabled = !s.enabled
    this.saveHeadingNumberingScoped(this.docContext.source, this.getDocumentKey(), s)

    if (s.enabled) {
      this.lastSnapshot = null
      this.renderedStates = null
      this.requestRefresh('toggle')
    } else {
      this.adapter.clearNumbering()
      this.outlineController.clearOutlineNumbering()
    }
    this.outlineToolbar.updateAllButtonStates()
    this.notifySettingsListeners()
    logger.info(`标题编号已${s.enabled ? '开启' : '关闭'}`)
  }

  /** Toggle numbering from outline toolbar — always document scope. */
  private toggleNumberingFromToolbar(): void {
    const s = this.s
    s.enabled = !s.enabled
    // Always save to current document (not global)
    const docKey = this.getDocumentKey()
    if (docKey) {
      this.saveHeadingNumberingScoped('document', docKey, { ...s })
    } else {
      this.saveHeadingNumberingScoped(this.docContext.source, this.getDocumentKey(), s)
    }

    if (s.enabled) {
      this.lastSnapshot = null
      this.renderedStates = null
      this.flushRefresh()
    } else {
      this.adapter.clearNumbering()
      this.outlineController.clearOutlineNumbering()
    }
    this.outlineToolbar.updateAllButtonStates()
    this.notifySettingsListeners()
  }

  /** Toggle heading structure mode from outline toolbar — always document scope. */
  private toggleLevelOneFromToolbar(): void {
    const s = this.s
    const currentMode = s.headingStructureMode ?? (s.showLevelOneNumber ? 'loose' : 'strict')
    const newMode: import('./heading-structure').HeadingStructureMode = currentMode === 'strict' ? 'loose' : 'strict'
    s.headingStructureMode = newMode
    s.showLevelOneNumber = newMode === 'loose'
    const docKey = this.getDocumentKey()
    if (docKey) {
      this.saveHeadingNumberingScoped('document', docKey, { ...s })
    } else {
      this.saveHeadingNumberingScoped(this.docContext.source, this.getDocumentKey(), s)
    }
    this.lastSnapshot = null
    this.renderedStates = null
    this.flushRefresh()
    this.outlineToolbar.updateAllButtonStates()
    this.notifySettingsListeners()
  }

  renumber(): void {
    const s = this.s
    if (!s.enabled) {
      s.enabled = true
      this.saveHeadingNumberingScoped(this.docContext.source, this.getDocumentKey(), s)
    }
    this.lastSnapshot = null
    this.renderedStates = null
    this.flushRefresh()
    logger.info('标题已重新编号')
  }

  /** Toggle level-one heading numbering on/off. */
  toggleLevelOneNumber(): void {
    this.setShowLevelOneNumber(!(this.s.showLevelOneNumber ?? false))
  }

  /** Set whether level-one heading shows numbering. @deprecated Use setHeadingStructureMode instead. */
  setShowLevelOneNumber(enabled: boolean): void {
    if (this.s.showLevelOneNumber === enabled) return
    const s = this.s
    s.headingStructureMode = enabled ? 'loose' : 'strict'
    s.showLevelOneNumber = enabled
    this.saveHeadingNumberingScoped(this.docContext.source, this.getDocumentKey(), s)
    this.lastSnapshot = null
    this.renderedStates = null
    this.flushRefresh()
    this.outlineToolbar.updateAllButtonStates()
    this.notifySettingsListeners()
    logger.info(`一级标题编号已${enabled ? '开启' : '关闭'}`)
  }

  /** Apply a preset and update numbering immediately. */
  applyPreset(preset: HeadingNumberingPreset): void {
    const s = this.s
    if (preset === 'custom') {
      s.preset = 'custom'
      if (s.customDefinition) {
        s.levels = { ...s.customDefinition }
      }
    } else {
      if (s.preset === 'custom') {
        s.customDefinition = { ...s.levels }
      }
      s.preset = preset
      s.levels = { ...getPresetLevels(preset) }
    }
    this.saveHeadingNumberingScoped(this.docContext.source, this.getDocumentKey(), s)
    this.lastSnapshot = null
    this.renderedStates = null
    this.flushRefresh()
    logger.info(`编号预设已切换为：${preset}`)
  }

  /** Update a single level's style. Automatically switches preset to 'custom'. */
  updateLevelStyle(level: HeadingLevel, patch: Partial<HeadingLevelStyle>): void {
    const s = this.s
    if (s.preset !== 'custom') {
      s.customDefinition = { ...s.levels }
      s.preset = 'custom'
      s.levels = { ...s.levels }
    }
    s.levels = { ...s.levels, [level]: { ...s.levels[level], ...patch } }
    s.customDefinition = { ...s.levels }
    this.saveHeadingNumberingScoped(this.docContext.source, this.getDocumentKey(), s)
    this.lastSnapshot = null
    this.renderedStates = null
    this.flushRefresh()
  }

  /**
   * Update the active format variant for a level.
   * Automatically writes to withLevelOne or withoutLevelOne based on current H1 state.
   */
  updateActiveFormat(level: HeadingLevel, nextFormat: readonly import('./heading-types').NumberFormatSegment[]): void {
    if (this.s.preset !== 'custom') {
      this.s.customDefinition = { ...this.s.levels }
      this.s.preset = 'custom'
      this.s.levels = { ...this.s.levels }
    }

    const currentStyle = this.s.levels[level]
    const showL1 = resolveHeadingStructure(this.s).showLevelOneNumber
    const updated = updateActiveFormatVariant(
      currentStyle,
      level,
      showL1,
      nextFormat,
    )

    this.s.levels = {
      ...this.s.levels,
      [level]: updated,
    }
    this.s.customDefinition = { ...this.s.levels }
    this.saveHeadingNumberingScoped(this.docContext.source, this.getDocumentKey(), { ...this.s })

    this.lastSnapshot = null
    this.renderedStates = null
    this.flushRefresh()
  }

  /**
   * Update the active contextual format variant for a level (schemaVersion >= 8).
   */
  updateActiveContextualFormat(level: HeadingLevel, nextFormat: readonly import('./heading-types').ContextualFormatSegment[]): void {
    if (this.s.preset !== 'custom') {
      this.s.customDefinition = { ...this.s.levels }
      this.s.preset = 'custom'
      this.s.levels = { ...this.s.levels }
    }

    const currentStyle = this.s.levels[level]
    const showL1 = resolveHeadingStructure(this.s).showLevelOneNumber
    const updated = updateActiveContextualFormatVariant(
      currentStyle,
      level,
      showL1,
      nextFormat,
    )

    // Sync multilevelFormatVariants from contextual for backward compat
    updated.multilevelFormatVariants = contextualToMultilevelVariants(updated.contextualFormatVariants)

    this.s.levels = {
      ...this.s.levels,
      [level]: updated,
    }
    this.s.customDefinition = { ...this.s.levels }
    this.saveHeadingNumberingScoped(this.docContext.source, this.getDocumentKey(), { ...this.s })

    this.lastSnapshot = null
    this.renderedStates = null
    this.flushRefresh()
  }

  /**
   * Update a single segment's appearance within the active contextual format.
   */
  updateContextualSegment(
    lv: HeadingLevel,
    segmentId: string,
    patch: Partial<import('./heading-types').LevelReferenceAppearance>,
  ): void {
    if (this.s.preset !== 'custom') {
      this.s.customDefinition = { ...this.s.levels }
      this.s.preset = 'custom'
      this.s.levels = { ...this.s.levels }
    }

    const currentStyle = this.s.levels[lv]
    const active = currentStyle.contextualFormatVariants
    if (!active) return

    const showL1 = resolveHeadingStructure(this.s).showLevelOneNumber
    const fmt = lv === 1 ? active.withLevelOne : (showL1 ? active.withLevelOne : active.withoutLevelOne)

    const nextFmt = fmt.map(seg => {
      if (seg.type === 'level-reference' && seg.id === segmentId) {
        return {
          ...seg,
          appearance: { ...seg.appearance, ...patch },
        }
      }
      return seg
    })

    const updated = updateActiveContextualFormatVariant(
      currentStyle,
      lv,
      showL1,
      nextFmt,
    )

    // Sync multilevelFormatVariants for backward compat
    updated.multilevelFormatVariants = contextualToMultilevelVariants(updated.contextualFormatVariants)

    this.s.levels = {
      ...this.s.levels,
      [lv]: updated,
    }
    this.s.customDefinition = { ...this.s.levels }
    this.saveHeadingNumberingScoped(this.docContext.source, this.getDocumentKey(), { ...this.s })

    this.lastSnapshot = null
    this.renderedStates = null
    this.flushRefresh()
  }

  /**
   * Update the active multilevel format variant for a level (two-layer model).
   */
  updateActiveMultilevelFormat(level: HeadingLevel, nextFormat: readonly import('./heading-types').MultilevelFormatSegment[]): void {
    if (this.s.preset !== 'custom') {
      this.s.customDefinition = { ...this.s.levels }
      this.s.preset = 'custom'
      this.s.levels = { ...this.s.levels }
    }

    const currentStyle = this.s.levels[level]
    const showL1 = resolveHeadingStructure(this.s).showLevelOneNumber
    const updated = updateActiveMultilevelFormatVariant(
      currentStyle,
      level,
      showL1,
      nextFormat,
    )

    this.s.levels = {
      ...this.s.levels,
      [level]: updated,
    }
    this.s.customDefinition = { ...this.s.levels }
    this.saveHeadingNumberingScoped(this.docContext.source, this.getDocumentKey(), { ...this.s })

    this.lastSnapshot = null
    this.renderedStates = null
    this.flushRefresh()
  }

  /**
   * Update a level's number template (tokenStyle, prefix, suffix).
   */
  updateLevelTemplate(level: HeadingLevel, patch: Partial<import('./heading-types').HeadingLevelNumberTemplate>): void {
    if (this.s.preset !== 'custom') {
      this.s.customDefinition = { ...this.s.levels }
      this.s.preset = 'custom'
      this.s.levels = { ...this.s.levels }
    }

    const currentStyle = this.s.levels[level]
    const currentTemplate = currentStyle.levelTemplate
    const updatedTemplate = { ...currentTemplate, ...patch }
    // Also sync legacy tokenStyle for backward compat
    const updatedStyle = {
      ...currentStyle,
      levelTemplate: updatedTemplate,
      tokenStyle: patch.tokenStyle ?? currentStyle.tokenStyle,
    }

    this.s.levels = {
      ...this.s.levels,
      [level]: updatedStyle,
    }
    this.s.customDefinition = { ...this.s.levels }
    this.saveHeadingNumberingScoped(this.docContext.source, this.getDocumentKey(), { ...this.s })

    this.lastSnapshot = null
    this.renderedStates = null
    this.flushRefresh()
  }

  /** Reset a single level to defaults. */
  resetLevelStyle(level: HeadingLevel): void {
    const defaults = getPresetLevels('custom')
    // Ensure we're in custom mode
    if (this.s.preset !== 'custom') {
      this.s.customDefinition = { ...this.s.levels }
      this.s.preset = 'custom'
    }
    const defaultStyle = defaults[level]
    this.s.levels = {
      ...this.s.levels,
      [level]: { ...defaultStyle },
    }
    this.s.customDefinition = { ...this.s.levels }
    this.saveHeadingNumberingScoped(this.docContext.source, this.getDocumentKey(), { ...this.s })
    this.lastSnapshot = null
    this.renderedStates = null
    this.flushRefresh()
  }

  /** Reset all custom levels to defaults. */
  resetAllCustomLevels(): void {
    const defaults = getPresetLevels('custom')
    this.s.preset = 'custom'
    this.s.levels = { ...defaults }
    this.s.customDefinition = { ...defaults }
    this.saveHeadingNumberingScoped(this.docContext.source, this.getDocumentKey(), { ...this.s })
    this.lastSnapshot = null
    this.renderedStates = null
    this.flushRefresh()
    logger.info('自定义设置已恢复为默认值')
  }

  /** Get the current numbering settings (for UI reading). */
  getCurrentSettings(): HeadingNumberingSettings {
    return { ...this.s }
  }

  /**
   * Subscribe to settings changes. Returns unsubscribe function.
   * Used by settings tab to react to external changes (F1 commands, etc.).
   */
  onSettingsChanged(listener: (settings: HeadingNumberingSettings) => void): () => void {
    this.settingsListeners.push(listener)
    return () => {
      const idx = this.settingsListeners.indexOf(listener)
      if (idx >= 0) this.settingsListeners.splice(idx, 1)
    }
  }

  private notifySettingsListeners(): void {
    const snapshot = { ...this.s }
    for (const listener of this.settingsListeners) {
      try { listener(snapshot) } catch (e) { logger.error('设置变化监听器异常', e) }
    }
  }

  /** Generate a preview of the current preset/levels. */
  getPreview(): Record<HeadingLevel, string> {
    return getPresetPreview(this.s.preset)
  }

  // ── Level range ──────────────────────────────────────

  /** Get the current level range settings from plugin config. */
  getLevelRangeSettings(): HeadingLevelRangeSettings {
    const raw = this.ctx.settings.get('levelRange')
    if (!raw) return { defaultMaxLevel: 6, documentOverrides: {} }
    return {
      defaultMaxLevel: clampMaxLevel(raw.defaultMaxLevel),
      documentOverrides: raw.documentOverrides ?? {},
    }
  }

  /** Resolve the effective max level for the currently open document. */
  getEffectiveMaxLevel(): HeadingLevel {
    const rangeSettings = this.getLevelRangeSettings()
    const docKey = this.getDocumentKey()
    const docPath = this.getActiveFilePath()
    return resolveEffectiveMaxLevel(rangeSettings, docKey ?? docPath)
  }

  // ── Heading override store ───────────────────────

  /** Get or create the override store for the current document. */
  getOverrideStore(): HeadingOverrideStore | null {
    const docPath = this.getActiveFilePath()
    if (!docPath) return null

    if (!this.overrideStore || this.overrideStore.toDocumentOverrides().documentKey !== docPath) {
      // Load persisted overrides or create new store
      const overrides = this.loadPersistedOverrides(docPath)
      this.overrideStore = new HeadingOverrideStore(docPath, overrides)
    }
    return this.overrideStore
  }

  /** Load persisted overrides from plugin settings. */
  private loadPersistedOverrides(docPath: string): Record<string, import('./heading-types').HeadingNumberingOverride> | undefined {
    try {
      const store = this.scopeStore
      const docOverride = store.documentOverrides[docPath]
      return (docOverride?.settings as any)?._overrides as Record<string, import('./heading-types').HeadingNumberingOverride> | undefined
    } catch {
      return undefined
    }
  }

  /** Persist overrides to plugin settings. */
  persistOverrides(): void {
    if (!this.overrideStore) return
    const overrides = this.overrideStore.getAllOverrides()
    const docKey = this.getDocumentKey()
    if (!docKey) return
    // Save overrides within the document override settings
    const s = this.s
    ;(s as any)._overrides = overrides
    this.saveHeadingNumberingScoped(this.docContext.source, docKey, s)
  }

  /** Build override map for the numbering engine from the store. */
  private buildOverrideMap(headings: readonly import('./heading-types').HeadingDescriptor[]): import('./numbering-engine').HeadingOverrideMap | undefined {
    const store = this.getOverrideStore()
    if (!store) return undefined

    const map = new Map<string, 'numbered' | 'unnumbered'>()
    const nameSettings = this.getSpecialNumberingSettings().nameSettings
    const showL1 = resolveHeadingStructure(this.s).showLevelOneNumber

    for (const h of headings) {
      const parentInfo = this.buildParentStructure(headings, h)
      const fp = HeadingOverrideStore.fingerprint(
        store.toDocumentOverrides().documentKey,
        h.level,
        parentInfo,
        h.text.replace(/[\s\u00A0]+/g, '').slice(0, 60),
      )
      const resolved = store.resolveMode(
        h.level, fp, this.getParentFingerprints(headings, h, store),
        h.text,
        nameSettings.candidates.filter(c => c.enabled),
        nameSettings.matchMode,
        showL1 ?? false,
      )
      if (resolved.mode !== 'inherit') {
        map.set(h.key, resolved.mode)
      }
    }

    return map
  }

  private buildParentStructure(
    headings: readonly import('./heading-types').HeadingDescriptor[],
    current: import('./heading-types').HeadingDescriptor,
  ): import('./heading-override-store').ParentStructure {
    let parentLine: string | null = null
    const ancestorLevels: import('./heading-types').HeadingLevel[] = []
    let foundLevel = current.level

    for (let i = headings.indexOf(current) - 1; i >= 0; i--) {
      const h = headings[i]
      if (h.level < foundLevel) {
        if (!parentLine) parentLine = h.key
        ancestorLevels.unshift(h.level)
        foundLevel = h.level
        if (h.level === 1) break
      }
    }

    return { parentLine, ancestorLevels }
  }

  private getParentFingerprints(
    headings: readonly import('./heading-types').HeadingDescriptor[],
    current: import('./heading-types').HeadingDescriptor,
    store: HeadingOverrideStore,
  ): string[] {
    const fps: string[] = []
    let foundLevel = current.level
    for (let i = headings.indexOf(current) - 1; i >= 0; i--) {
      const h = headings[i]
      if (h.level < foundLevel) {
        const parentInfo = this.buildParentStructure(headings, h)
        const fp = HeadingOverrideStore.fingerprint(
          store.toDocumentOverrides().documentKey,
          h.level, parentInfo,
          h.text.replace(/[\s\u00A0]+/g, '').slice(0, 60),
        )
        fps.push(fp)
        foundLevel = h.level
        if (h.level === 1) break
      }
    }
    return fps
  }

  /** Get the special numbering settings. */
  getSpecialNumberingSettings(): import('./heading-types').SpecialHeadingNumberingSettings {
    try {
      const raw = this.ctx.settings.get('specialNumbering' as any) as any
      const result = raw ?? { unnumberedCounterPolicy: 'skip' as const, nameSettings: { enabled: false, candidates: [], matchMode: 'trim' as const, matchAction: 'prompt' as const } }
      // Completely remove name-based unnumbering
      if (result.nameSettings) {
        result.nameSettings.enabled = false
        result.nameSettings.candidates = []
      }
      return result
    } catch {
      return { unnumberedCounterPolicy: 'skip', nameSettings: { enabled: false, candidates: [], matchMode: 'trim', matchAction: 'prompt' } }
    }
  }

  // ── Command implementations ──────────────────────

  /** Get the heading element at the current cursor position. */
  private getCurrentHeadingElement(): HTMLHeadingElement | null {
    const sel = window.getSelection()
    if (!sel?.rangeCount) return null
    const node = sel.getRangeAt(0).startContainer
    if (node instanceof Element) {
      return node.closest('h1, h2, h3, h4, h5, h6')
    }
    return node.parentElement?.closest('h1, h2, h3, h4, h5, h6') ?? null
  }

  /** Get the key of the heading at the current cursor position. */
  private getCurrentHeadingKey(): string | null {
    const el = this.getCurrentHeadingElement()
    if (!el) return null
    return `${el.tagName}-${el.getAttribute('data-line') ?? ''}-${el.id ?? ''}`
  }

  /** Set override for the heading at cursor position. */
  setCurrentHeadingOverride(mode: 'inherit' | 'numbered' | 'unnumbered'): void {
    const store = this.getOverrideStore()
    if (!store) {
      Notice.info('未检测到打开的文档')
      return
    }
    const el = this.getCurrentHeadingElement()
    if (!el) {
      Notice.info('请将光标置于标题中')
      return
    }
    const headings = this.adapter.collectHeadings()
    const key = this.getCurrentHeadingKey()
    const heading = headings.find(h => h.key === key)
    if (!heading) return

    const parentInfo = this.buildParentStructure(headings, heading)
    const fp = HeadingOverrideStore.fingerprint(
      store.toDocumentOverrides().documentKey,
      heading.level,
      parentInfo,
      heading.text.replace(/[\s\u00A0]+/g, '').slice(0, 60),
    )

    if (mode === 'inherit') {
      store.removeOverride(fp)
    } else {
      store.setOverride(fp, mode, 'self', 'manual')
    }
    this.persistOverrides()
    this.lastSnapshot = null
    this.flushRefresh()

    const labels = { inherit: '恢复继承', numbered: '启用编号', unnumbered: '取消编号' }
    Notice.info(`当前标题：已${labels[mode]}`)
  }

  /** Batch override from current heading to end of siblings. */
  batchOverrideFromCurrent(mode: 'numbered' | 'unnumbered'): void {
    const store = this.getOverrideStore()
    if (!store) { Notice.info('未检测到打开的文档'); return }
    const el = this.getCurrentHeadingElement()
    if (!el) { Notice.info('请将光标置于标题中'); return }
    const headings = this.adapter.collectHeadings()
    const key = this.getCurrentHeadingKey()
    const idx = headings.findIndex(h => h.key === key)
    if (idx < 0) return

    const current = headings[idx]
    const siblings = headings.slice(idx).filter(h => h.level === current.level)
    const fps: string[] = []
    for (const sib of siblings) {
      const parentInfo = this.buildParentStructure(headings, sib)
      const fp = HeadingOverrideStore.fingerprint(
        store.toDocumentOverrides().documentKey,
        sib.level, parentInfo,
        sib.text.replace(/[\s\u00A0]+/g, '').slice(0, 60),
      )
      fps.push(fp)
    }

    store.batchSetOverrides(fps, mode, 'self', 'batch')
    this.persistOverrides()
    this.lastSnapshot = null
    this.flushRefresh()

    const action = mode === 'unnumbered' ? '停止' : '启用'
    Notice.info(`已对当前标题及后续 ${siblings.length - 1} 个同级标题${action}编号`)
  }

  /** Set subtree override. */
  setSubtreeOverride(mode: 'unnumbered' | 'inherit'): void {
    const store = this.getOverrideStore()
    if (!store) { Notice.info('未检测到打开的文档'); return }
    const el = this.getCurrentHeadingElement()
    if (!el) { Notice.info('请将光标置于标题中'); return }
    const headings = this.adapter.collectHeadings()
    const key = this.getCurrentHeadingKey()
    const idx = headings.findIndex(h => h.key === key)
    if (idx < 0) return

    const current = headings[idx]

    if (mode === 'inherit') {
      // Remove subtree override
      const parentInfo = this.buildParentStructure(headings, current)
      const fp = HeadingOverrideStore.fingerprint(
        store.toDocumentOverrides().documentKey,
        current.level, parentInfo,
        current.text.replace(/[\s\u00A0]+/g, '').slice(0, 60),
      )
      store.removeOverride(fp)
    } else {
      const parentInfo = this.buildParentStructure(headings, current)
      const fp = HeadingOverrideStore.fingerprint(
        store.toDocumentOverrides().documentKey,
        current.level, parentInfo,
        current.text.replace(/[\s\u00A0]+/g, '').slice(0, 60),
      )
      store.setOverride(fp, mode, 'subtree', 'manual')
    }

    this.persistOverrides()
    this.lastSnapshot = null
    this.flushRefresh()

    const label = mode === 'unnumbered' ? '已取消当前标题及其下级编号' : '已恢复当前标题及其下级继承'
    Notice.info(label)
  }

  /** Clear all overrides for current document. */
  clearDocumentOverrides(): void {
    const store = this.getOverrideStore()
    if (!store) return
    store.clearAll()
    this.persistOverrides()
    this.lastSnapshot = null
    this.flushRefresh()
  }

  /** Run outline diagnostic probe. */
  runOutlineProbe(callback: (log: string) => void): void {
    this.outlineController.runProbe(callback)
  }

  /** Run full DOM diagnostic dump (for manual command). */
  dumpOutlineDOM(): void {
    this.outlineController.dumpDOM()
  }

  /** Manual outline sync with diagnostic output. */
  manualOutlineSync(callback: (log: string) => void): { rootFound: boolean; bodyHeadingCount: number; outlineItemCount: number; matchedCount: number; matchedByIdx: number; attributeApplied: number; unmatchedCount: number } | null {
    return this.outlineController.manualSync(callback)
  }

  /** Set the global default max heading level. */
  setDefaultMaxLevel(maxLevel: MaxHeadingLevel): void {
    const rangeSettings = this.getLevelRangeSettings()
    rangeSettings.defaultMaxLevel = maxLevel
    this.ctx.settings.set('levelRange', { ...rangeSettings })
    this.lastSnapshot = null
    this.renderedStates = null
    this.levelRangeEnforcer.resetNotices()
    this.updateLastEffectiveMaxLevel()
    this.flushRefresh()
  }

  /** Set a per-document override for the given file path. */
  setDocumentOverride(docPath: string, override: DocumentHeadingLevelOverride): void {
    const rangeSettings = this.getLevelRangeSettings()
    rangeSettings.documentOverrides = {
      ...rangeSettings.documentOverrides,
      [docPath]: override,
    }
    this.ctx.settings.set('levelRange', { ...rangeSettings })
    this.lastSnapshot = null
    this.renderedStates = null
    this.levelRangeEnforcer.resetNotices()
    this.updateLastEffectiveMaxLevel()
    this.flushRefresh()
  }

  /** Remove a per-document override. */
  removeDocumentOverride(docPath: string): void {
    const rangeSettings = this.getLevelRangeSettings()
    if (rangeSettings.documentOverrides[docPath]) {
      delete rangeSettings.documentOverrides[docPath]
      rangeSettings.documentOverrides = { ...rangeSettings.documentOverrides }
      this.ctx.settings.set('levelRange', { ...rangeSettings })
    }
    this.lastSnapshot = null
    this.renderedStates = null
    this.levelRangeEnforcer.resetNotices()
    this.updateLastEffectiveMaxLevel()
    this.flushRefresh()
  }

  /** Track effective max level changes. */
  private updateLastEffectiveMaxLevel(): void {
    this.lastEffectiveMaxLevel = this.getEffectiveMaxLevel()
  }

  /**
   * Scan the current document for headings and identify out-of-range ones.
   * Uses editor.getMarkdown() for text-based parsing.
   * @param maxLevel Optional max level override. Defaults to current effective max.
   */
  scanDocumentHeadings(maxLevel?: number): HeadingScanResult {
    const ml = maxLevel ?? this.getEffectiveMaxLevel()
    const md = this.ctx.getMarkdown?.() ?? ''
    return scanHeadingsForRange(md, ml)
  }

  /**
   * Count headings by level in the current document.
   * Returns a record mapping each level (1-6) to the count.
   */
  countHeadingsByLevel(): Record<number, number> {
    const scan = this.scanDocumentHeadings(6) // scan ALL headings
    const counts: Record<number, number> = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0, 6: 0 }
    for (const h of scan.allHeadings) {
      if (h.level >= 1 && h.level <= 6) {
        counts[h.level]++
      }
    }
    return counts
  }

  /** Count out-of-range headings for the current effective max level. */
  countOutOfRangeHeadings(): number {
    return this.scanDocumentHeadings().outOfRange.length
  }

  /**
   * Convert out-of-range headings to bold paragraphs with undo support.
   * Returns true if conversion was performed.
   */
  convertOutOfRangeHeadings(): boolean {
    const scan = this.scanDocumentHeadings()
    if (scan.outOfRange.length === 0) return false

    const md = this.ctx.getMarkdown?.() ?? ''
    const newMd = convertHeadingsToBold(md, scan.outOfRange)
    if (newMd === md) return false

    this.ctx.reloadContent?.(newMd)
    return true
  }

  dispose(): void {
    this.disposed = true
    this.cancelPostTextInputStabilityObservation('UNLOAD')
    setPluginSelectionWriteSink(null)
    this.cancelPending()
    this.disconnectObserver()
    this.unbindEditorRoot()
    this.adapter.clearNumbering()
    this.store.dispose()
    this.levelRangeEnforcer.dispose()
    this.outlineController.stop()
    this.outlineToolbar.stop()
    if (this.pasteListenerTimer !== null) { clearTimeout(this.pasteListenerTimer); this.pasteListenerTimer = null }
    if (this.fileOpenRetryTimer !== null) { clearTimeout(this.fileOpenRetryTimer); this.fileOpenRetryTimer = null }
  }

  // ── Settings sync ──────────────────────────────────────

  /** Listen for external settings changes (e.g. from settings UI) and sync local state. */
  private registerSettingsListener(): void {
    const dispose = this.ctx.settings.onChange('headingNumbering', (_key: unknown, value: HeadingNumberingSettings) => {
      // Legacy listener: migrate and reload from scope store
      if (!this.scopeStore.schemaVersion) {
        const migResult = migrateHeadingNumberingToScopeStore({ headingNumbering: value })
        if (migResult.migrated) {
          this.persistScopeStore(migResult.store)
        }
      }
      this.loadDocumentContext()
      this.lastSnapshot = null
      this.renderedStates = null
      this.outlineToolbar.updateAllButtonStates()
      this.flushRefresh()
      this.notifySettingsListeners()
    })
    this.store.add(dispose)
  }

  // ── Scheduler ──────────────────────────────────────────

  /** Priority order for refresh reasons (higher = more important). */
  private static readonly REASON_PRIORITY: Record<string, number> = {
    'paragraph-command-mutation': 10,
    'editor-mutation': 8,
    'editor-input': 6,
    'composition-end': 5,
    'framework-edit': 5,
    'editor-keyup': 3,
    'editor-click': 3,
    'focus-in': 2,
    'decoration-repair': 1,
    'tail-refresh': 1,
  }

  private requestRefresh(reason: RefreshReason): void {
    this.pendingReasons.add(reason)

    // Dedupe: if already scheduled, just accumulate — don't schedule another RAF
    if (this.rafId !== null) return

    this.rafId = requestAnimationFrame(() => {
      this.rafId = null

      // Snapshot and clear pending reasons
      const reasons = new Set(this.pendingReasons)
      this.pendingReasons.clear()

      this.doRefreshWithReasons(reasons)
    })
  }

  /** Compute primary reason and paragraph command flag, then call doRefresh. */
  private doRefreshWithReasons(reasons: Set<RefreshReason>): void {
    if (reasons.size === 0) return

    const hasParagraphCommandMutation = reasons.has('paragraph-command-mutation')

    // Compute primary reason with priority
    let primaryReason: RefreshReason = 'editor-input'
    let maxPriority = -1
    for (const r of reasons) {
      const p = HeadingNumberingService.REASON_PRIORITY[r] ?? 0
      if (p > maxPriority) {
        maxPriority = p
        primaryReason = r
      }
    }

    // ── Trace: T4 RequestRefresh (fail-open) ──
    safeTrace(() => {
      traceT4_RequestRefresh({
        reasonsBeforeAdd: Array.from(reasons).filter(r => r !== primaryReason),
        reasonAdded: primaryReason,
        reasonsAfterAdd: Array.from(reasons),
        rafAlreadyPending: false, // RAF callback is executing now
        primaryReason,
        hasParagraphMutation: hasParagraphCommandMutation,
      })
    })

    // ── R58.2: Document switch — canonical registry lifecycle ──────────
    if (primaryReason === 'active-leaf-change' || primaryReason === 'file-open') {
      this.canonicalRegistry.clearDocumentBindings(this.getDocumentKey() ?? '')
      this.releaseOneShotHandoff('document-switch')
      // STRICT-FIRST-H1: force revalidation on the new document (no stale state/signature).
      this.strictFirstH1State = null
      this.strictFirstH1Signature = null
      console.info(
        `[InkChapter] CANONICAL-BINDING-DOCUMENT-SWITCH: reason=${primaryReason} ` +
        `registryRecordCount=${this.canonicalRegistry.recordCount}`,
      )
    }

    this.doRefresh(primaryReason, { hasParagraphCommandMutation })
  }

  private scheduleTail(reason: RefreshReason, ms: number): void {
    if (this.tailTimer !== null) clearTimeout(this.tailTimer)
    const expectedVersion = this.renderVersion
    const expectedDocKey = this.getDocumentKey()
    this.tailTimer = setTimeout(() => {
      this.tailTimer = null
      // Guard: skip if version or document changed since scheduling
      if (expectedVersion !== this.renderVersion) return
      if (expectedDocKey !== this.getDocumentKey()) return
      this.doRefresh(reason)
    }, ms)
  }

  private flushRefresh(): void {
    this.cancelPending()
    this.doRefresh('manual')
  }

  private cancelPending(): void {
    if (this.rafId !== null) { cancelAnimationFrame(this.rafId); this.rafId = null }
    if (this.tailTimer !== null) { clearTimeout(this.tailTimer); this.tailTimer = null }
  }

  // ── STRICT-FIRST-H1 reactive validation ─────────────────────────────

  /** Public cached state (settings UI reads this; never re-validates itself). */
  getStrictFirstH1State(): StrictFirstH1RuntimeState | null {
    return this.strictFirstH1State
  }

  /**
   * Public accessor for STRICT-FIRST-H1 top-line result (settings UI consumer).
   * Returns the cached runtime result; if absent, runs a read-only validation
   * from the live editor markdown buffer (UI_FALLBACK) — never mutates document.
   */
  getStrictFirstH1ToplineResult(): { result: StrictFirstH1ToplineResult; source: 'RUNTIME_STATE' | 'UI_FALLBACK' } {
    if (this.strictFirstH1State?.result) {
      return { result: this.strictFirstH1State.result, source: 'RUNTIME_STATE' }
    }
    const mode = resolveHeadingStructure(this.s).mode
    const markdown = this.ctx.getMarkdown?.() ?? ''
    return { result: validateStrictFirstH1Topline(markdown, mode), source: 'UI_FALLBACK' }
  }

  /** Subscribe to runtime validation state changes (settings UI auto-refresh). */
  onStrictFirstH1Changed(listener: () => void): () => void {
    this.strictFirstH1Listeners.push(listener)
    return () => {
      const idx = this.strictFirstH1Listeners.indexOf(listener)
      if (idx >= 0) this.strictFirstH1Listeners.splice(idx, 1)
    }
  }

  private notifyStrictFirstH1Changed(): void {
    for (const listener of this.strictFirstH1Listeners) {
      try { listener() } catch (e) { logger.error('STRICT-FIRST-H1 状态监听器异常', e) }
    }
  }

  /**
   * Reactive STRICT-FIRST-H1 validation. `validateStrictFirstH1` remains the
   * single source of truth; this layer only decides WHEN to run, caches the
   * result, emits audit, and notifies UI. Cheap skip when the first block's
   * structural signature and the mode are unchanged.
   */
  private revalidateStrictFirstH1(trigger: string): void {
    const structure = resolveHeadingStructure(this.s)
    const mode = structure.mode
    const docKey = this.getDocumentKey() ?? null
    const markdown = this.ctx.getMarkdown?.() ?? ''
    const signature = computeDocumentStartSignature(markdown)

    const prev = this.strictFirstH1State
    const prevMode = prev?.mode ?? null
    const prevSignature = this.strictFirstH1Signature
    const prevHasResult = prev?.result != null
    const prevDecision = prev?.result?.decision ?? 'NONE'

    if (!shouldRevalidateStrictFirstH1(prevMode, prevSignature, prevHasResult, mode, signature)) {
      emitRuntimeAudit('STRICT-DOCUMENT-VALIDATION-TRIGGER', {
        documentKey: docKey ?? 'none',
        mode,
        trigger,
        previousDecision: prevDecision,
        nextDecision: prev!.result!.decision,
        decision: 'SKIP',
        reason: 'SKIP_REVALIDATION_DOCUMENT_START_UNCHANGED',
      })
      return
    }

    const result = validateStrictFirstH1Topline(markdown, mode)
    this.strictFirstH1State = { documentKey: docKey, mode, result, updatedAt: Date.now(), trigger }
    this.strictFirstH1Signature = signature

    emitRuntimeAudit('STRICT-DOCUMENT-VALIDATION-TRIGGER', {
      documentKey: docKey ?? 'none',
      mode,
      trigger,
      previousDecision: prevDecision,
      nextDecision: result.decision,
      sourceKind: 'EDITOR_MARKDOWN',
      documentStartState: result.documentStartState,
      firstLineRaw: result.firstLineRaw ?? null,
      firstBlockType: result.firstBlockType ?? null,
      firstHeadingLevel: result.firstHeadingLevel ?? null,
      decision: result.decision === 'SKIP' ? 'SKIP' : 'RUN',
      reason: result.reason,
    })

    if (result.decision !== 'SKIP') {
      emitRuntimeAudit('STRICT-DOCUMENT-VALIDATION', {
        documentKey: docKey ?? 'none',
        mode,
        ruleId: 'STRICT-FIRST-H1',
        sourceKind: 'EDITOR_MARKDOWN',
        documentStartState: result.documentStartState,
        firstLineRaw: result.firstLineRaw ?? null,
        firstBlockType: result.firstBlockType ?? null,
        firstHeadingLevel: result.firstHeadingLevel ?? null,
        decision: result.decision,
        reason: result.reason,
      })
    }

    this.notifyStrictFirstH1Changed()
  }

  // ── Core refresh ───────────────────────────────────────

  private doRefresh(reason: RefreshReason, flags?: { hasParagraphCommandMutation?: boolean }): void {
    const startTime = performance.now()
    const hasParagraphCommand = flags?.hasParagraphCommandMutation ?? false

    recordRuntimeAudit('doRefresh:start', {
      documentKey: this.getDocKey(),
      renderVersion: this.renderVersion,
      refreshReason: reason,
      hasParagraphCommand,
    })

    try {
      const root = this.adapter.detectEditorRoot()
      if (!root) return
      this.adapter.setEditorRoot(root)

      // ── Trace: T5 doRefresh (fail-open) ──
      this.traceDoRefreshCount++
      safeTrace(() => {
        traceT5_DoRefresh({
          doRefreshCount: this.traceDoRefreshCount,
          primaryReason: reason,
          allPendingReasons: hasParagraphCommand ? [reason, 'paragraph-command-mutation'] : [reason],
          editorRootDetected: true,
          documentKey: this.getDocumentKey(),
          willCallRehydrate: true,
          willCallRefreshStyles: true,
        })
      })

      // Apply heading layouts (always, independent of numbering state)
      this.applyHeadingLayouts()

      // ── Rehydrate explicit paragraph overrides before layout refresh ──
      // Normal Enter / paragraph split destroys HTMLElement identity.
      // Rehydrate force-indent from in-memory registry BEFORE refreshParagraphIndentStyles
      // so explicit overrides survive DOM rebuild.
      this.rehydrateParagraphIndentOverrides(root)

      // Apply paragraph indent styles (always)
      this.refreshParagraphIndents()

      // ── STRICT-FIRST-H1 reactive validation (runs even when numbering off) ──
      this.revalidateStrictFirstH1(reason)

      // Numbering: skip if disabled
      if (!this.s.enabled) return

      const snapshot = this.adapter.createHeadingSnapshot()
      const forceRefresh = FORCE_REFRESH_REASONS.has(reason)

      if (!forceRefresh && this.lastSnapshot && this.renderedStates) {
        // Structure unchanged?
        if (!this.adapter.hasStructureChanged(this.lastSnapshot, snapshot)) {
          // Full state check: element refs, class, attr
          if (this.adapter.isRenderedStateValid(this.renderedStates)) {
            // Also check gaps — Typora may strip data-inkchapter-heading-gap on Enter
            if (this.renderedGaps && !this.adapter.areGapsValid(this.renderedGaps)) {
              this.adapter.applyLabelGaps(this.renderedGaps)
            }
            this.lastSnapshot = snapshot
            return // Everything is fine, skip
          }
          // Structure same but decoration lost → repair only (node replaced)
          const diff = this.adapter.repairDecoration(this.renderedStates)
          this.renderedStates = this.adapter.buildRenderedStates(
            this.renderedStates.map(s => s.label),
          )
          // Also re-apply gaps after repair
          if (this.renderedGaps) {
            this.adapter.applyLabelGaps(this.renderedGaps)
          }
          this.logRefresh(reason, snapshot.length, diff, startTime)
          this.lastSnapshot = snapshot
          return
        }
      }

      // Full refresh
      this.lastSnapshot = snapshot

      const headings = this.adapter.collectHeadings()
      snapshotHeadingCollection(headings)
      if (headings.length === 0) {
        this.adapter.clearNumbering()
        this.renderedStates = null
        this.renderedGaps = null
        recordRuntimeAudit('doRefresh:end', { headingCount: 0 })
        return
      }

      // Snapshot config before computation
      snapshotConfigSource('pre-compute', {
        showLevelOneNumber: this.s.showLevelOneNumber,
        preset: this.s.preset,
        maxDepth: this.s.maxDepth,
        levels: Object.fromEntries(
          [1, 2, 3, 4, 5, 6].map(lv => [
            lv,
            {
              enabled: this.s.levels[lv as HeadingLevel]?.enabled ?? false,
              cVarWith: this.s.levels[lv as HeadingLevel]?.contextualFormatVariants?.withLevelOne?.length ?? 0,
              cVarWithout: this.s.levels[lv as HeadingLevel]?.contextualFormatVariants?.withoutLevelOne?.length ?? 0,
            },
          ]),
        ),
      })

      // Apply effective max level from level range settings
      const effectiveMax = this.getEffectiveMaxLevel()
      this.s.maxDepth = effectiveMax

      // Build override map from store
      const overrideMap = this.buildOverrideMap(headings)

      // Get counter policy
      const specialSettings = this.getSpecialNumberingSettings()
      const counterPolicy = specialSettings.unnumberedCounterPolicy

      const numbered = computeHeadingNumbering(headings, this.s, overrideMap, counterPolicy)
      const labels = decimalHierarchicalFormatter.format(numbered, this.s)

      // Snapshot numbering engine per-heading output
      const engineEntries: NumberingEngineEntry[] = numbered.map((h, i) => {
        const style = this.s.levels[h.level as HeadingLevel]
        const enabledLvls = [1, 2, 3, 4, 5, 6].filter(
          lv => lv === 1 ? this.s.showLevelOneNumber : (this.s.levels[lv as HeadingLevel]?.enabled ?? false),
        ) as number[]
        const depth = enabledLvls.indexOf(h.level) >= 0 ? enabledLvls.indexOf(h.level) + 1 : null
        return {
          headingIndex: i,
          actualLevel: h.level,
          styleLevelUsed: h.level,
          styleEnabled: style?.enabled ?? false,
          visibleDepth: depth,
          enabledLevels: enabledLvls,
          activeCounters: h.counters as number[],
          selectedVariant: h.level === 1 ? 'withLevelOne' : (!this.s.showLevelOneNumber ? 'withoutLevelOne' : 'withLevelOne'),
          variantSegmentCount: 0,
          generatedLabel: h.label,
          textPreview: h.text.slice(0, 40),
        }
      })
      snapshotNumberingEngine(this.s, engineEntries)

      const diff = this.adapter.applyNumberingDiff(labels)
      this.renderedStates = this.adapter.buildRenderedStates(labels)

      // Apply per-heading label gaps (number-to-title spacing)
      const gaps = extractLabelGaps(numbered)
      this.adapter.applyLabelGaps(gaps)
      this.renderedGaps = [...gaps]

      // Snapshot apply-diff
      const headingEls = this.adapter.getEditorRoot()?.querySelectorAll<HTMLElement>('h1,h2,h3,h4,h5,h6') ?? []
      const diffEntries: ApplyDiffEntry[] = []
      let di = 0; for (const el of Array.from(headingEls).slice(0, 20)) {
        diffEntries.push({
          domIndex: di, domKey: el.tagName + '-' + (el.getAttribute('data-line') ?? ''), tagName: el.tagName,
          parsedLevel: parseInt(el.tagName.charAt(1)), textPreview: (el.textContent ?? '').slice(0, 40),
          labelIndex: di, incomingLabel: di < labels.length ? labels[di] : 'N/A',
          previousAttr: el.getAttribute('data-inkchapter-heading-number'),
          action: di < labels.length ? (labels[di] ? 'update' : 'skip-empty') : 'skip-empty',
          nextAttr: null as string | null,
        });
        di++
      }
      snapshotApplyDiff(labels, diffEntries, labels.length, headingEls.length)

      // Sync outline sidebar numbering — pass the authoritative documentKey.
      this.outlineController.syncAfterRefresh(this.getDocumentKey() ?? '', headings, labels, gaps)

      // Output H2 diagnostic in dev mode (first load only)
      if (reason === 'initial-load' || reason === 'file-open') {
        try { diagnoseHeadingChain(headings, this.s) } catch { /* silent */ }
      }

      this.logRefresh(reason, headings.length, diff, startTime)
      recordRuntimeAudit('doRefresh:end', {
        headingCount: headings.length,
        labelCount: labels.length,
        refreshReason: reason,
        renderVersion: this.renderVersion,
      })

      // ── Trace: save T0 snapshot for next cycle + record T8 ──
      this.captureTraceEndOfDoRefresh(root)
    } catch (e) {
      logger.error('标题编号刷新失败', e)
      recordRuntimeAudit('doRefresh:error', { details: { error: String(e) } })
    }
  }

  // ── Heading layout ─────────────────────────────────────

  /** Apply heading layout to the editor (independent of numbering state). */
  private applyHeadingLayouts(): void {
    const structure = resolveHeadingStructure(this.s)
    const layouts = this.getEffectiveHeadingLayouts(structure.mode)
    if (!layouts) {
      this.adapter.clearHeadingLayouts()
      return
    }
    // Layout is physical H1-H6 (NO level shift): real H2 uses layout.h2.
    this.adapter.applyHeadingLayouts(layouts)
  }

  /** Apply paragraph indent styles to the editor DOM. */
  private refreshParagraphIndents(): void {
    const root = this.adapter.getEditorRoot()
    if (!root) return
    const settings = this.getParagraphLayoutSettings()

    // ── Trace: T7 before ──
    let t7Target: HTMLElement | null = null
    let t7BeforeClass: string | null = null
    let t7BeforeData: string | null = null
    safeTrace(() => {
      const contentParas = root.querySelectorAll<HTMLParagraphElement>('p')
      for (const p of contentParas) {
        if (p.classList.contains('inkchapter-paragraph-effective-indent-2')) {
          t7Target = p
          break
        }
      }
      if (t7Target) {
        t7BeforeClass = t7Target.className ? String(t7Target.className) : null
        t7BeforeData = t7Target.getAttribute('data-inkchapter-indent-mode')
      }
    })

    // Business: always execute (never inside trace wrapper)
    refreshParagraphIndentStyles(root, settings, this.isInComposition)

    // ── Trace: T7 after ──
    safeTrace(() => {
      if (!t7Target) return
      const afterClass = t7Target.className ? String(t7Target.className) : null
      const afterData = t7Target.getAttribute('data-inkchapter-indent-mode')
      traceT7_RefreshStyles({
        targetElement: summarizeElement(t7Target),
        beforeClass: t7BeforeClass,
        beforeDataMode: t7BeforeData,
        afterClass,
        afterDataMode: afterData,
        didRendererClear: (t7BeforeClass?.includes('inkchapter-paragraph-effective-indent-2') ?? false) && !(afterClass?.includes('inkchapter-paragraph-effective-indent-2') ?? false),
      })
    })
  }

  /**
   * SOLE COMMIT OWNER: keydown Enter capture starts the transaction.
   *
   * Only keydown can identify token, create transaction, consume token,
   * write semantic/sidecar, project visual, and restore caret.
   * beforeinput(insertParagraph) must NOT commit — only suppress native split.
   */
  private tryStartEnterIndentTransaction(event: KeyboardEvent, root: HTMLElement): boolean {
    if (event.key !== 'Enter') return false
    if (this.isInComposition || event.isComposing) return false

    const settings = this.getParagraphLayoutSettings()
    if (!settings.indentShortcutEnabled) return false

    // R58.7 Phase A: Gate — no business mutations without document context
    if (!this.assertDocumentContextReady('special-command')) return false

    // R58.7 Phase A.1.3.1a: Snapshot immutable runtime scope for this transaction
    const scopeRef = this.snapshotRuntimeScope()
    if (!scopeRef) {
      logger.warn(`TRANSACTION-ABORTED: reason=SCOPE_NOT_READY`)
      return false
    }

    if (this.activeEnterTransaction) return false // one transaction at a time

    const sel = window.getSelection()
    if (!sel?.rangeCount || !sel.isCollapsed) return false

    const paragraph = resolveCurrentBodyParagraph(root)
    if (!paragraph) return false

    const token = readParagraphIndentCommand(paragraph)
    if (!token) return false
    if (!isCaretAtTokenEnd(paragraph, 2)) return false

    // ── Create transaction, lock paragraph ──
    const txnId = 'txn-' + (++this.enterTxnSeq) + '-' + Date.now()
    // R58.6.7: Advance user intent epoch for special command
    this.beginTrustedUserIntent('SPECIAL_COMMAND', 'keydown', 'Enter')
    const txn: EnterIndentTransaction = {
      id: txnId,
      startedAt: performance.now(),
      paragraph,
      token,
      paragraphCountBefore: root ? collectContentParagraphs(root).length : -1,
      state: 'created',
      suppressNativeInsertParagraph: false,
      semanticWritten: false,
      sidecarWritten: false,
      tokenConsumed: false,
      scopeRef,
      traceData: { txnId, event: 'keydown', key: 'Enter', token, paraCountBefore: root ? collectContentParagraphs(root).length : -1, beforeinput_suppressed: false },
    }
    this.activeEnterTransaction = txn

    // ── Sync commit ──
    this.commitEnterIndentTransactionSync(txn, event)
    return true
  }

  // ── P0: Empty Paragraph Special-Command (token-only) ───────────────────────

  /**
   * Synchronous phase of a token-only empty special command. Captures the plan,
   * consumes the token, applies optimistic semantic/visual, then defers the
   * canonical commit + caret + verify to AFTER Typora's empty-block normalization.
   */
  private commitEmptySpecialTransactionSync(txn: EnterIndentTransaction, event: Event, para: HTMLElement): void {
    const commandRuntimeId = this.getParagraphRuntimeId(para)
    const root = this.adapter.getEditorRoot()
    const allParas = root ? collectContentParagraphs(root) : []
    const paraIndex = allParas.indexOf(para)
    const prevEl = paraIndex > 0 ? allParas[paraIndex - 1] : null
    const nextEl = paraIndex >= 0 && paraIndex < allParas.length - 1 ? allParas[paraIndex + 1] : null
    const prevRtId = prevEl ? this.getParagraphRuntimeId(prevEl) : null
    const nextRtId = nextEl ? this.getParagraphRuntimeId(nextEl) : null

    const exact = this.canonicalRegistry.resolveExactLiveRecord(para)
    const existingRecordId = exact?.recordId ?? null

    const emptyTxn: EmptySpecialCommandTransaction = {
      txnId: txn.id,
      scopeId: this.documentContext.scopeId ?? (this.getDocumentKey() ?? 'unknown'),
      intentEpoch: this.userIntentEpoch,
      sourceElement: para,
      sourceRuntimeId: commandRuntimeId,
      sourceOrdinal: paraIndex,
      previousElement: prevEl,
      previousRuntimeId: prevRtId,
      nextElement: nextEl,
      nextRuntimeId: nextRtId,
      paragraphCountBefore: txn.paragraphCountBefore,
      sourceWasTokenOnly: true,
      existingCanonicalRecordId: existingRecordId,
      desiredMode: 'force-indent',
      state: 'PRE_CAPTURED',
      authorizedCaretWriteCount: 0,
      resolvedRuntimeId: null,
    }
    this.activeEmptySpecialTransaction = emptyTxn

    // A: Native empty DOM root-cause probe — read-only sampling across phases.
    const nativeEmptyRef = this.findNativeEmptyReferenceParagraph(para, prevEl, nextEl, allParas)
    this.emitEmptyBlockDomSnapshot('NATIVE_EMPTY', nativeEmptyRef, nativeEmptyRef ? this.getParagraphRuntimeId(nativeEmptyRef) : null)
    this.emitEmptyBlockDomSnapshot('BEFORE_TOKEN_CONSUME', para, commandRuntimeId)

    emitRuntimeAudit('EMPTY-SPECIAL-PRE', {
      txnId: emptyTxn.txnId,
      intentEpoch: emptyTxn.intentEpoch,
      scopeId: emptyTxn.scopeId,
      sourceRuntimeId: commandRuntimeId,
      sourceOrdinal: paraIndex,
      previousRuntimeId: prevRtId ?? 'none',
      nextRuntimeId: nextRtId ?? 'none',
      previousVisibleText: prevEl ? getUserVisibleParagraphText(prevEl) : '',
      sourceVisibleText: getUserVisibleParagraphText(para),
      nextVisibleText: nextEl ? getUserVisibleParagraphText(nextEl) : '',
      paragraphCountBefore: txn.paragraphCountBefore,
      selectionRuntimeId: commandRuntimeId,
      logicalOffset: 2,
      existingCanonicalRecordId: existingRecordId ?? 'none',
    })

    // P0-B: ARM the mutation window BEFORE consuming the token.
    this.armEmptySpecialMutationWindow(emptyTxn, root, para.isConnected)

    // consume Enter + token
    event.preventDefault()
    event.stopPropagation()
    this.clearParagraphToken(para, txn.token)
    txn.tokenConsumed = true
    emptyTxn.state = 'TOKEN_CONSUMED'
    const settleCtx = this.activeEmptySpecialSettle
    if (settleCtx) {
      settleCtx.tokenConsumedAt = performance.now()
      settleCtx.observerArmedBeforeTokenConsume = settleCtx.observerArmedAt <= settleCtx.tokenConsumedAt
    }
    emitRuntimeAudit('EMPTY-SPECIAL-TOKEN-CONSUMED', {
      txnId: emptyTxn.txnId,
      token: txn.token,
      sourceRuntimeId: commandRuntimeId,
      tokenConsumedAt: settleCtx?.tokenConsumedAt ?? 0,
    })

    // P0-A: restore the token-consumed empty paragraph to Typora-native empty.
    const norm = normalizeTokenConsumedEmptyParagraph({
      txnId: emptyTxn.txnId,
      runtimeId: commandRuntimeId,
      paragraph: para,
    })
    emitRuntimeAudit('EMPTY-SPECIAL-DOM-NORMALIZATION', {
      txnId: norm.txnId,
      intentEpoch: emptyTxn.intentEpoch,
      runtimeId: norm.runtimeId,
      beforeInnerHTML: norm.beforeInnerHTML,
      afterInnerHTML: norm.afterInnerHTML,
      beforeChildNodeCount: norm.beforeChildNodeCount,
      afterChildNodeCount: norm.afterChildNodeCount,
      beforeVisibleText: norm.beforeVisibleText,
      afterVisibleText: norm.afterVisibleText,
      nativeEmptyEquivalentBefore: norm.nativeEmptyEquivalentBefore,
      nativeEmptyEquivalentAfter: norm.nativeEmptyEquivalentAfter,
      markdownContentChanged: norm.markdownContentChanged,
      decision: norm.decision,
      overall: norm.overall,
    })
    // P0-A forensic predicate — precise reason for SAFE_EMPTY vs REJECT.
    const sp = norm.spanPredicate
    if (sp) {
      emitRuntimeAudit('EMPTY-SPECIAL-EMPTY-SPAN-PREDICATE', {
        txnId: emptyTxn.txnId,
        runtimeId: norm.runtimeId,
        spanTag: sp.spanTag,
        mdInlineValue: sp.mdInlineValue,
        classList: sp.classList,
        spanChildNodeCount: sp.spanChildNodeCount,
        spanTextNodeCount: sp.spanTextNodeCount,
        spanElementChildCount: sp.spanElementChildCount,
        textNodeValues: sp.textNodeValues,
        spanTextContent: sp.spanTextContent,
        hasNestedElement: sp.hasNestedElement,
        hasNonTextNode: sp.hasNonTextNode,
        hasNonEmptyTextNode: sp.hasNonEmptyTextNode,
        matchesExpectedMdPlainShape: sp.matchesExpectedMdPlainShape,
        safeEmptyTextShape: sp.safeEmptyTextShape,
        rejectReason: sp.rejectReason ?? 'none',
        decision: sp.decision,
      })
    }
    if (norm.decision === 'BLOCK_UNSAFE_STRUCTURE') {
      this.finishEmptySpecialBlocked(emptyTxn, 'BLOCK_UNSAFE_EMPTY_DOM')
      return
    }
    emptyTxn.state = 'DOM_NORMALIZED'
    this.emitEmptyBlockDomSnapshot('AFTER_TOKEN_CONSUME', para, commandRuntimeId)

    // optimistic semantic + visual on source (re-applied to final owner after settle)
    setParagraphIndentMode(para, 'force-indent', WriterIds.ENTER_COMMIT_SEMANTIC)
    const settings = this.getParagraphLayoutSettings()
    const structural = { isFormulaContinuation: settings.flushAfterDisplayMath ? isAfterDisplayMath(para) : false }
    const effective = resolveEffectiveParagraphIndent('force-indent', settings.defaultIndent, structural)
    applyEffectiveParagraphIndent(para, effective, WriterIds.ENTER_COMMIT_VISUAL)
    txn.semanticWritten = true
    emptyTxn.state = 'NORMALIZATION_PENDING'

    // ENTER-COMMIT-ATOMIC degraded to SYNCHRONOUS_PHASE_PASS (NOT final authority)
    logger.info(`ENTER-COMMIT-ATOMIC: txnId=${txn.id} tokenSuccess=true phase=SYNCHRONOUS_PHASE_PASS overallSuccess=true(degraded)`)

    this.scheduleEmptySpecialSettle(emptyTxn)
  }

  /** P0-B: Arm the mutation window BEFORE token consume (so the normalization batch is observed). */
  private armEmptySpecialMutationWindow(
    emptyTxn: EmptySpecialCommandTransaction,
    root: HTMLElement | null,
    sourceConnectedBefore: boolean,
  ): void {
    const ctx: EmptySpecialSettleContext = {
      emptyTxn,
      root,
      observer: null,
      observerArmedAt: performance.now(),
      tokenConsumedAt: 0,
      observerArmedBeforeTokenConsume: false,
      mutationGeneration: 0,
      relevantMutationCount: 0,
      relevantMutationTypes: new Set(),
      sourceConnectedBefore,
      sourceConnectedAfter: sourceConnectedBefore,
      paragraphCountBefore: emptyTxn.paragraphCountBefore,
      version: 0,
      quietFrames: 0,
      lastSeenVersion: 0,
      settled: false,
      rafId: null,
      observerRootConnectedAtArm: false,
      observerRootContainsSourceAtArm: false,
      sourceConnectedAtArm: false,
      observerRootIsCurrentEditorRoot: false,
      editorInstanceId: this.documentContext.editorInstanceId ?? 'unknown',
    }
    this.activeEmptySpecialSettle = ctx

    if (!root) return

    ctx.observer = new MutationObserver((records) => {
      if (ctx.settled) {
        // Stale callback already queued before terminal close — drop, no generation/mutation.
        emitRuntimeAudit('EMPTY-SPECIAL-STALE-CALLBACK-DROP', {
          txnId: emptyTxn.txnId,
          terminalState: emptyTxn.state,
          callbackType: 'MUTATION_OBSERVER',
          decision: 'DROP_STALE',
        })
        return
      }
      ctx.version++
      ctx.mutationGeneration++
      let relevantCount = 0
      for (const r of records) {
        if (this.isRelevantEmptySpecialMutation(r, emptyTxn, root)) {
          relevantCount++
          ctx.relevantMutationTypes.add(r.type)
        }
      }
      if (relevantCount > 0) {
        ctx.relevantMutationCount += relevantCount
        emptyTxn.state = 'MUTATION_OBSERVED'
        emitRuntimeAudit('EMPTY-SPECIAL-MUTATION', {
          txnId: emptyTxn.txnId,
          mutationGeneration: ctx.mutationGeneration,
          batchSize: records.length,
          relevantBatchSize: relevantCount,
        })
      }
    })
    ctx.observer.observe(root, { childList: true, subtree: true, characterData: true })

    // ARM-time immutable snapshot — captured AFTER observer.observe, BEFORE token consume.
    ctx.observerRootConnectedAtArm = !!(root && root.isConnected)
    ctx.observerRootContainsSourceAtArm = !!(root && root.contains(emptyTxn.sourceElement))
    ctx.sourceConnectedAtArm = emptyTxn.sourceElement.isConnected
    ctx.observerRootIsCurrentEditorRoot = root === this.adapter.getEditorRoot()
    emitRuntimeAudit('EMPTY-SPECIAL-MUTATION-WINDOW-ARM', {
      txnId: emptyTxn.txnId,
      intentEpoch: emptyTxn.intentEpoch,
      observerRootConnectedAtArm: ctx.observerRootConnectedAtArm,
      observerRootContainsSourceAtArm: ctx.observerRootContainsSourceAtArm,
      sourceConnectedAtArm: ctx.sourceConnectedAtArm,
      observerRootIsCurrentEditorRoot: ctx.observerRootIsCurrentEditorRoot,
      editorInstanceId: ctx.editorInstanceId,
      observerArmedAt: ctx.observerArmedAt,
      decision: 'ARMED',
    })
    emptyTxn.state = 'MUTATION_WINDOW_ARMED'
  }

  private scheduleEmptySpecialSettle(emptyTxn: EmptySpecialCommandTransaction): void {
    const ctx = this.activeEmptySpecialSettle
    if (!ctx || ctx.emptyTxn.txnId !== emptyTxn.txnId) {
      this.finishEmptySpecialBlocked(emptyTxn, 'NO_SETTLE_CONTEXT')
      return
    }
    const startedAt = Date.now()
    const requiredQuietFrames = 2
    const maxTimeoutMs = 300

    // AFTER_MICROTASK probe (runs after the current synchronous task completes).
    queueMicrotask(() => {
      if (ctx.settled) return
      const connected = emptyTxn.sourceElement.isConnected
      this.emitEmptyBlockDomSnapshot(
        'AFTER_MICROTASK',
        connected ? emptyTxn.sourceElement : null,
        connected ? emptyTxn.sourceRuntimeId : null,
      )
    })

    const finalize = (decision: EmptySpecialSettleDecisionName | 'NO_ROOT') => {
      if (ctx.settled) return
      ctx.settled = true
      ctx.sourceConnectedAfter = emptyTxn.sourceElement.isConnected
      this.emitEmptySpecialSettleAudit(ctx, decision)
      if (decision === 'SETTLED_BY_MUTATION_QUIET' || decision === 'SETTLED_NO_RELEVANT_MUTATION') {
        emptyTxn.state = 'QUIET_BOUNDARY_REACHED'
        this.settleEmptySpecialTransaction(emptyTxn)
      } else if (decision === 'TIMEOUT_BLOCK') {
        this.finishEmptySpecialTimeoutBlock(emptyTxn)
      } else {
        this.finishEmptySpecialBlocked(emptyTxn, 'NO_EDITOR_ROOT')
      }
    }

    if (!ctx.root) {
      finalize('NO_ROOT')
      return
    }

    const tick = () => {
      if (ctx.settled) {
        emitRuntimeAudit('EMPTY-SPECIAL-STALE-CALLBACK-DROP', {
          txnId: emptyTxn.txnId,
          terminalState: emptyTxn.state,
          callbackType: 'RAF_TICK',
          decision: 'DROP_STALE',
        })
        return
      }
      if (this.activeEmptySpecialTransaction?.txnId !== emptyTxn.txnId) {
        if (ctx.observer) ctx.observer.disconnect()
        ctx.settled = true
        return
      }
      const elapsedMs = Date.now() - startedAt
      if (ctx.version !== ctx.lastSeenVersion) {
        ctx.lastSeenVersion = ctx.version
        ctx.quietFrames = 0
      } else {
        ctx.quietFrames++
      }
      const sourceConnected = emptyTxn.sourceElement.isConnected
      const topologyStable = ctx.quietFrames >= requiredQuietFrames
      const decision = decideEmptySpecialSettle({
        mutationGeneration: ctx.mutationGeneration,
        relevantMutationCount: ctx.relevantMutationCount,
        quietFramesSinceMutation: ctx.quietFrames,
        elapsedMs,
        maxTimeoutMs,
        requiredQuietFrames,
        sourceConnected,
        topologyStable,
      })
      if (decision.decision !== 'PENDING') {
        finalize(decision.decision)
        return
      }
      ctx.rafId = requestAnimationFrame(tick)
    }

    ctx.rafId = requestAnimationFrame(tick)
  }

  /** P0-B: Single terminal cleanup authority for every empty-special terminal path. */
  private closeEmptySpecialTransaction(emptyTxn: EmptySpecialCommandTransaction, finalState: string): void {
    const ctx = this.activeEmptySpecialSettle
    let observerDisconnected = false
    if (ctx && ctx.emptyTxn.txnId === emptyTxn.txnId) {
      ctx.settled = true
      if (ctx.observer) {
        ctx.observer.disconnect()
        ctx.observer = null
        observerDisconnected = true
      }
      if (ctx.rafId != null) {
        cancelAnimationFrame(ctx.rafId)
        ctx.rafId = null
      }
    }
    if (this.activeEmptySpecialTransaction && shouldClearActiveTxn(this.activeEmptySpecialTransaction.txnId, emptyTxn.txnId)) {
      this.activeEmptySpecialTransaction = null
    }
    if (this.activeEmptySpecialSettle?.emptyTxn && shouldClearActiveTxn(this.activeEmptySpecialSettle.emptyTxn.txnId, emptyTxn.txnId)) {
      this.activeEmptySpecialSettle = null
    }
    // P0-C: the EnterIndentTransaction also owns the one-at-a-time gate.
    if (this.activeEnterTransaction && shouldClearActiveTxn(this.activeEnterTransaction.id, emptyTxn.txnId)) {
      this.activeEnterTransaction = null
    }
    emptyTxn.state = finalState === 'COMMITTED' ? 'COMMITTED' : 'BLOCKED'
    emitRuntimeAudit('EMPTY-SPECIAL-TRANSACTION-CLOSE', {
      txnId: emptyTxn.txnId,
      finalState,
      observerDisconnected,
      timeoutCleared: true,
      rafOwnershipCleared: true,
      mutationBufferCleared: true,
      activeTxnCleared: true,
      terminal: true,
      overall: true,
    })
  }

  private emitEmptySpecialSettleAudit(ctx: EmptySpecialSettleContext, decision: EmptySpecialSettleDecisionName | 'NO_ROOT'): void {
    const emptyTxn = ctx.emptyTxn
    const paragraphCountAfter = ctx.root ? collectContentParagraphs(ctx.root).length : emptyTxn.paragraphCountBefore
    emitRuntimeAudit('EMPTY-SPECIAL-SETTLE-AUDIT', {
      txnId: emptyTxn.txnId,
      intentEpoch: emptyTxn.intentEpoch,
      observerArmedAt: ctx.observerArmedAt,
      tokenConsumedAt: ctx.tokenConsumedAt,
      observerArmedBeforeTokenConsume: ctx.observerArmedBeforeTokenConsume,
      mutationGenerationStart: 0,
      mutationGenerationEnd: ctx.mutationGeneration,
      relevantMutationCount: ctx.relevantMutationCount,
      relevantMutationTypes: Array.from(ctx.relevantMutationTypes),
      sourceConnectedBefore: ctx.sourceConnectedBefore,
      sourceConnectedAfter: ctx.sourceConnectedAfter,
      observerRootConnectedAtArm: ctx.observerRootConnectedAtArm,
      observerRootContainsSourceAtArm: ctx.observerRootContainsSourceAtArm,
      sourceConnectedAtArm: ctx.sourceConnectedAtArm,
      observerRootIsCurrentEditorRoot: ctx.observerRootIsCurrentEditorRoot,
      paragraphCountBefore: emptyTxn.paragraphCountBefore,
      paragraphCountAfter,
      quietBoundaryReached: decision === 'SETTLED_BY_MUTATION_QUIET',
      timeoutReached: decision === 'TIMEOUT_BLOCK',
      decision,
    })
  }

  /** A mutation is relevant when it is a structural/characterData change touching source/prev/next. */
  private isRelevantEmptySpecialMutation(record: MutationRecord, emptyTxn: EmptySpecialCommandTransaction, root: HTMLElement): boolean {
    const target = record.target

    if (record.type === 'childList') {
      if (target === root) return true
      const relevantEls: (HTMLElement | null)[] = [emptyTxn.sourceElement, emptyTxn.previousElement, emptyTxn.nextElement]
      for (const el of relevantEls) {
        if (!el) continue
        if (target === el) return true
        if (target.contains && target.contains(el)) return true
        for (let i = 0; i < record.addedNodes.length; i++) {
          const n = record.addedNodes[i]
          if (n === el || (n instanceof Node && el.contains(n))) return true
        }
        for (let i = 0; i < record.removedNodes.length; i++) {
          const n = record.removedNodes[i]
          if (n === el || (n instanceof Node && el.contains(n))) return true
        }
      }
      return false
    }

    if (record.type === 'characterData') {
      const relevantEls: (HTMLElement | null)[] = [emptyTxn.sourceElement, emptyTxn.previousElement, emptyTxn.nextElement]
      for (const el of relevantEls) {
        if (el && target instanceof Node && el.contains(target)) return true
      }
      return false
    }

    return false
  }

  /**
   * Failed-Txn one-shot test hook. Only the FORCE_VISUAL_VERIFY_FAIL_ONCE hook is
   * implemented. Default disabled; armed only in the test vault + explicit config
   * + document match + remaining>0. It ONLY overrides the effective visual-verify
   * result (never touches Markdown/Selection/DOM/canonical/sidecar/caret).
   */
  private consumeEmptySpecialRuntimeTestHook(
    emptyTxn: EmptySpecialCommandTransaction,
    originalVisualVerify: boolean,
  ): { effectiveVisualVerify: boolean; armed: boolean; consumed: boolean } {
    const vaultRoot = this.ctx.vaultRoot ?? null
    const activeFilePath = this.getActiveFilePath()
    const activeDocumentKey = this.getDocumentKey()
    const config = readEmptySpecialTestHookFile(vaultRoot)

    if (!config) {
      return { effectiveVisualVerify: originalVisualVerify, armed: false, consumed: false }
    }

    const result = evaluateEmptySpecialTestHook({
      hook: config.hook ?? null,
      configuredDocument: config.document ?? null,
      activeDocumentKey,
      activeFilePath,
      remaining: typeof config.remaining === 'number' ? config.remaining : 0,
      isTestVault: isTestVaultRoot(vaultRoot) || isTestVaultPath(activeFilePath),
      originalVisualVerify,
    })

    // One-shot consume: persist remaining -> remainingAfter (0 on first fire).
    if (result.armed) {
      writeEmptySpecialTestHookFile(vaultRoot, { ...config, remaining: result.remainingAfter })
    }

    emitRuntimeAudit('EMPTY-SPECIAL-TEST-HOOK', {
      txnId: emptyTxn.txnId,
      hook: config.hook ?? 'none',
      documentKey: activeDocumentKey ?? activeFilePath ?? 'none',
      armed: result.armed,
      consumed: result.consumed,
      originalVisualVerify: result.originalVisualVerify,
      effectiveVisualVerify: result.effectiveVisualVerify,
      remainingBefore: result.remainingBefore,
      remainingAfter: result.remainingAfter,
    })

    return {
      effectiveVisualVerify: result.effectiveVisualVerify,
      armed: result.armed,
      consumed: result.consumed,
    }
  }

  private settleEmptySpecialTransaction(emptyTxn: EmptySpecialCommandTransaction): void {
    if (this.activeEmptySpecialTransaction?.txnId !== emptyTxn.txnId) return
    if (this.userIntentEpoch !== emptyTxn.intentEpoch) {
      this.finishEmptySpecialSuperseded(emptyTxn)
      return
    }
    const root = this.adapter.getEditorRoot()
    if (!root) {
      this.finishEmptySpecialBlocked(emptyTxn, 'NO_EDITOR_ROOT')
      return
    }

    const allParas = collectContentParagraphs(root)
    const paragraphCountAfter = allParas.length
    const sourceConnected = emptyTxn.sourceElement.isConnected

    const candidateRuntimeIds: string[] = []
    if (!sourceConnected) {
      for (const p of allParas) {
        if (!p.isConnected) continue
        const rt = this.getParagraphRuntimeId(p)
        if (rt === emptyTxn.sourceRuntimeId) continue
        if (this.isEmptySlotCandidate(p, emptyTxn, allParas)) candidateRuntimeIds.push(rt)
      }
    }

    const resolution = resolveEmptySlot({
      sourceConnected,
      sourceRuntimeId: emptyTxn.sourceRuntimeId,
      previousRuntimeId: emptyTxn.previousRuntimeId,
      nextRuntimeId: emptyTxn.nextRuntimeId,
      candidateRuntimeIds,
      paragraphCountBefore: emptyTxn.paragraphCountBefore,
      paragraphCountAfter,
    })
    emptyTxn.resolvedRuntimeId = resolution.resolvedRuntimeId

    emitRuntimeAudit('EMPTY-SPECIAL-STRUCTURAL-RESOLUTION', {
      txnId: emptyTxn.txnId,
      decision: resolution.decision,
      sourceRuntimeId: resolution.sourceRuntimeId,
      resolvedRuntimeId: resolution.resolvedRuntimeId ?? 'none',
      previousRuntimeId: resolution.previousRuntimeId ?? 'none',
      nextRuntimeId: resolution.nextRuntimeId ?? 'none',
      candidateCount: resolution.candidateCount,
      paragraphCountBefore: resolution.paragraphCountBefore,
      paragraphCountAfter: resolution.paragraphCountAfter,
    })

    const paragraphCountPreserved = paragraphCountAfter === emptyTxn.paragraphCountBefore
    if (!paragraphCountPreserved) {
      this.finishEmptySpecialBlocked(emptyTxn, 'PARAGRAPH_COUNT_CHANGED')
      return
    }
    if (resolution.decision === 'AMBIGUOUS' || resolution.decision === 'MISSING') {
      this.finishEmptySpecialBlocked(emptyTxn, resolution.decision === 'AMBIGUOUS' ? 'AMBIGUOUS_SLOT' : 'MISSING_SLOT')
      return
    }

    let finalElement: HTMLElement | null = null
    let finalRtId: string | null = null
    if (resolution.decision === 'SAME_NODE') {
      finalElement = emptyTxn.sourceElement
      finalRtId = emptyTxn.sourceRuntimeId
    } else {
      finalRtId = resolution.resolvedRuntimeId
      finalElement = allParas.find(p => this.getParagraphRuntimeId(p) === finalRtId) ?? null
    }
    if (!finalElement || !finalRtId) {
      this.finishEmptySpecialBlocked(emptyTxn, 'NO_FINAL_ELEMENT')
      return
    }
    emptyTxn.state = 'STRUCTURE_RESOLVED'
    this.emitEmptyBlockDomSnapshot('AFTER_RAF', finalElement, finalRtId)

    // re-apply provisional semantic + visual on final owner
    setParagraphIndentMode(finalElement, 'force-indent', WriterIds.ENTER_COMMIT_SEMANTIC)
    const settings = this.getParagraphLayoutSettings()
    const structural = { isFormulaContinuation: settings.flushAfterDisplayMath ? isAfterDisplayMath(finalElement) : false }
    const effective = resolveEffectiveParagraphIndent('force-indent', settings.defaultIndent, structural)
    applyEffectiveParagraphIndent(finalElement, effective, WriterIds.ENTER_COMMIT_VISUAL)

    const semanticCorrect = getParagraphIndentMode(finalElement) === 'force-indent'
    const isNativeEmpty = isNativeEmptyParagraph(finalElement)
    const emptyEquivalent = isEmptyEquivalentParagraph(finalElement)
    const projectionMode: EmptyProjectionMode = decideEmptyProjectionMode(emptyEquivalent, semanticCorrect ? 'force-indent' : 'auto')
    const cs = window.getComputedStyle(finalElement)
    const computedTextIndent = cs.textIndent
    const computedPaddingInlineStart = cs.paddingLeft
    const visualIndentCorrect = semanticCorrect && this.emptyVisualIndentCorrect(projectionMode, cs)

    emitRuntimeAudit('EMPTY-SPECIAL-EMPTY-VISUAL-PROJECTION', {
      txnId: emptyTxn.txnId,
      runtimeId: finalRtId,
      isNativeEmpty,
      emptyEquivalent,
      semanticMode: semanticCorrect ? 'force-indent' : getParagraphIndentMode(finalElement),
      projectionMode,
      computedTextIndent,
      computedPaddingInlineStart,
    })
    emitRuntimeAudit('EMPTY-SPECIAL-VISUAL-VERIFY', {
      txnId: emptyTxn.txnId,
      runtimeId: finalRtId,
      semanticCorrect,
      projectionMode,
      emptyEquivalent,
      computedTextIndent,
      computedPaddingInlineStart,
      visualIndentCorrect,
    })

    // Failed-Txn one-shot test hook (FORCE_VISUAL_VERIFY_FAIL_ONCE): only the
    // effective visual-verify result is overridden; nothing else is touched.
    const originalVisualVerify = visualIndentCorrect
    const testHook = this.consumeEmptySpecialRuntimeTestHook(emptyTxn, originalVisualVerify)
    const effectiveVisualVerify = testHook.effectiveVisualVerify

    // transaction-scoped caret restore (logical caret verify)
    const caretLogical = this.emptySpecialCaretRestore(emptyTxn, finalElement, finalRtId, root)
    emptyTxn.state = 'CARET_VERIFIED'
    emitRuntimeAudit('EMPTY-SPECIAL-CARET-VERIFY', {
      txnId: emptyTxn.txnId,
      resolvedRuntimeId: finalRtId,
      caretLogicalCorrect: caretLogical,
      authorizedCaretWriteCount: emptyTxn.authorizedCaretWriteCount,
    })

    // caret geometry (visual caret verify) — P0-VC authority
    const geometry = this.emptySpecialCaretGeometry(finalElement, projectionMode)
    emitRuntimeAudit('EMPTY-SPECIAL-CARET-GEOMETRY', {
      txnId: emptyTxn.txnId,
      runtimeId: finalRtId,
      projectionMode: geometry.projectionMode,
      fontSizePx: geometry.fontSizePx,
      expectedIndentPx: geometry.expectedIndentPx,
      paragraphRectLeft: geometry.paragraphRectLeft,
      borderInlineStartWidth: geometry.borderInlineStartWidth,
      paddingInlineStart: geometry.paddingInlineStart,
      textIndentPx: geometry.textIndentPx,
      paragraphContentLeft: geometry.paragraphContentLeft,
      unindentedVisualStart: geometry.unindentedVisualStart,
      caretRectLeft: geometry.caretRectLeft,
      actualCaretIndentPx: geometry.actualCaretIndentPx,
      tolerancePx: geometry.tolerancePx,
      logicalOffset: geometry.logicalOffset,
      overall: geometry.overall,
    })

    const preCommitVerifyPassed = semanticCorrect && effectiveVisualVerify && caretLogical && geometry.overall
    if (!preCommitVerifyPassed) {
      // P0-AC: nothing committed yet — roll back provisional projection only.
      this.rollbackEmptySpecialProjection(emptyTxn, finalElement, 'none', 'PRE_COMMIT_VERIFY_FAILED')
      this.closeEmptySpecialTransaction(emptyTxn, 'BLOCKED')
      emitRuntimeAudit('EMPTY-SPECIAL-FINAL', {
        txnId: emptyTxn.txnId,
        sourceWasTokenOnly: true,
        overall: false,
        blockedReason: 'PRE_COMMIT_VERIFY_FAILED',
      })
      return
    }

    // P0-AC: deferred canonical commit — ONLY after every verification passed.
    const docKey = this.getDocumentKey() ?? ''
    const docPath = this.ctx.getActiveFilePath?.() ?? 'unknown'
    const canonical = this.commitEmptySpecialCanonical(emptyTxn, finalElement, finalRtId, docKey, docPath)
    emptyTxn.state = 'CANONICAL_COMMITTED'
    emitRuntimeAudit('EMPTY-SPECIAL-CANONICAL-COMMIT', {
      txnId: emptyTxn.txnId,
      recordId: canonical.recordId,
      decision: canonical.decision,
      success: canonical.success,
      resolvedRuntimeId: finalRtId,
      sourceRuntimeId: emptyTxn.sourceRuntimeId,
    })

    const canonicalOwnerCorrect = canonical.success && canonical.recordId !== '' &&
      this.canonicalRegistry.resolveExactLiveRecord(finalElement)?.recordId === canonical.recordId

    const finalReport = evaluateEmptySpecialFinal({
      logicalSlotPreserved: true,
      paragraphCountPreserved,
      canonicalOwnerCorrect,
      semanticCorrect,
      visualIndentCorrect,
      caretLogicalCorrect: caretLogical,
      caretVisualCorrect: geometry.overall,
      authorizedCaretWriteCount: emptyTxn.authorizedCaretWriteCount,
      unexpectedMerge: false,
      unexpectedDelete: false,
    })

    emitRuntimeAudit('EMPTY-SPECIAL-FINAL', {
      txnId: emptyTxn.txnId,
      sourceWasTokenOnly: true,
      logicalSlotPreserved: finalReport.logicalSlotPreserved,
      paragraphCountPreserved: finalReport.paragraphCountPreserved,
      canonicalOwnerCorrect: finalReport.canonicalOwnerCorrect,
      semanticCorrect: finalReport.semanticCorrect,
      visualIndentCorrect: finalReport.visualIndentCorrect,
      caretLogicalCorrect: finalReport.caretLogicalCorrect,
      caretVisualCorrect: finalReport.caretVisualCorrect,
      authorizedCaretWriteCount: finalReport.authorizedCaretWriteCount,
      unexpectedMerge: finalReport.unexpectedMerge,
      unexpectedDelete: finalReport.unexpectedDelete,
      overall: finalReport.overall,
    })

    const commitDecision = decideEmptySpecialCommit({
      preCommitVerifyPassed,
      canonicalCommitSucceeded: canonical.success,
      canonicalOwnerCorrect,
    })

    if (commitDecision === 'COMMIT') {
      this.closeEmptySpecialTransaction(emptyTxn, 'COMMITTED')
      return
    }

    // P0-AC: post-commit rollback — remove the just-created record + projection.
    this.rollbackEmptySpecialCanonical(canonical, docKey)
    this.rollbackEmptySpecialProjection(emptyTxn, finalElement, canonical.recordId, 'COMMIT_GATE_ROLLBACK')
    this.closeEmptySpecialTransaction(emptyTxn, 'BLOCKED')
  }

  /** A replacement candidate must be a connected, empty paragraph between prev and next. */
  private isEmptySlotCandidate(p: HTMLElement, emptyTxn: EmptySpecialCommandTransaction, allParas: HTMLElement[]): boolean {
    const rt = this.getParagraphRuntimeId(p)
    if (rt === emptyTxn.sourceRuntimeId) return false
    if (getUserVisibleParagraphText(p) !== '') return false
    const idx = allParas.indexOf(p)
    if (idx < 0) return false
    let minIdx = -1
    let maxIdx = allParas.length
    if (emptyTxn.previousRuntimeId) {
      const prevIdx = allParas.findIndex(x => this.getParagraphRuntimeId(x) === emptyTxn.previousRuntimeId)
      if (prevIdx >= 0) minIdx = prevIdx
    }
    if (emptyTxn.nextRuntimeId) {
      const nextIdx = allParas.findIndex(x => this.getParagraphRuntimeId(x) === emptyTxn.nextRuntimeId)
      if (nextIdx >= 0) maxIdx = nextIdx
    }
    return idx > minIdx && idx < maxIdx
  }

  /** Deferred canonical commit: UPDATE_EXISTING for existing, CREATE only after unique final owner. */
  private commitEmptySpecialCanonical(
    emptyTxn: EmptySpecialCommandTransaction,
    finalElement: HTMLElement,
    finalRtId: string,
    docKey: string,
    docPath: string,
  ): { recordId: string; decision: 'UPDATE_EXISTING' | 'CREATE' | 'BLOCK'; success: boolean } {
    const root = this.adapter.getEditorRoot()
    const allParas = root ? collectContentParagraphs(root) : []
    const paraIndex = allParas.indexOf(finalElement)
    const anchor = paraIndex >= 0 ? createParagraphAnchor(paraIndex, allParas) : { lastKnownOrdinal: -1 }
    const isTemporary = !finalElement.textContent?.trim()
    const scopeId = this.documentContext.scopeId ?? docKey

    const existingId = emptyTxn.existingCanonicalRecordId
    if (existingId) {
      const overrides = this.inMemoryOverrides.get(docKey) ?? []
      const existing = overrides.find(o => o.id === existingId)
      if (existing) {
        // D: CAS-like rebind lease — must pass BEFORE any identity mutation; failure = BLOCK (no CREATE_NEW).
        if (finalRtId !== emptyTxn.sourceRuntimeId) {
          const meta = this.canonicalRegistry.getRuntimeMeta(existingId)
          const rebound = this.canonicalRegistry.rebindCurrentLiveRecord(existingId, finalElement, finalRtId, {
            scopeId,
            documentKey: docKey,
            expectedGeneration: meta?.generation,
            expectedOldRuntimeId: meta?.currentRuntimeId,
          })
          if (!rebound) {
            return { recordId: existingId, decision: 'BLOCK', success: false }
          }
        }
        existing.mode = 'force-indent'
        existing.anchor = anchor
        existing.temporary = isTemporary
        this.inMemoryOverrides.set(docKey, [...overrides])
        this.scheduleSidecarWrite(docKey, docPath, overrides)
        return { recordId: existingId, decision: 'UPDATE_EXISTING', success: true }
      }
    }

    // CREATE — only after unique final owner confirmed by settle.
    // Register into the live registry FIRST; only on success update in-memory
    // overrides + schedule sidecar (atomic: a failed register leaks nothing).
    const overrides = this.inMemoryOverrides.get(docKey) ?? []
    const newId = `indent-${Date.now()}-${overrides.length}`
    const newRecord: ParagraphIndentOverrideRecord = {
      id: newId,
      mode: 'force-indent',
      anchor,
      temporary: isTemporary,
    }
    try {
      this.canonicalRegistry.registerCurrentSessionRecord(
        newRecord, docKey, finalElement, finalRtId, isTemporary,
        scopeId,
        this.documentContext.persistenceKey,
      )
    } catch (e) {
      logger.warn(`EMPTY-SPECIAL-CANONICAL-REGISTER-WARN: ${e}`)
      return { recordId: newId, decision: 'BLOCK', success: false }
    }
    overrides.push(newRecord)
    this.inMemoryOverrides.set(docKey, [...overrides])
    this.scheduleSidecarWrite(docKey, docPath, overrides)
    return { recordId: newId, decision: 'CREATE', success: true }
  }

  /** Transaction-scoped caret restore: at most ONE authorized selection write. */
  private emptySpecialCaretRestore(
    emptyTxn: EmptySpecialCommandTransaction,
    finalElement: HTMLElement,
    finalRtId: string,
    root: HTMLElement,
  ): boolean {
    const truth = resolveSelectionTruth(root, (el: object) => this.getParagraphRuntimeId(el as HTMLElement), 'EMPTY-SPECIAL-CARET-VERIFY')
    if (truth.runtimeId === finalRtId && truth.logicalOffset === 0) return true

    if (emptyTxn.authorizedCaretWriteCount >= 1) return false
    if (this.userIntentEpoch !== emptyTxn.intentEpoch) return false
    if (!finalElement.isConnected) return false

    const repair = repairCaretAtParagraphLogicalStart(finalElement, root, finalRtId, (el: object) => this.getParagraphRuntimeId(el as HTMLElement))
    if (!repair.success) return false

    emptyTxn.authorizedCaretWriteCount++
    emitRuntimeAudit('EMPTY-SPECIAL-CARET-RESTORE', {
      txnId: emptyTxn.txnId,
      runtimeId: finalRtId,
      authorizedCaretWriteCount: emptyTxn.authorizedCaretWriteCount,
      repairSuccess: repair.success,
    })
    const verify = resolveSelectionTruth(root, (el: object) => this.getParagraphRuntimeId(el as HTMLElement), 'EMPTY-SPECIAL-CARET-VERIFY-AFTER')
    return verify.runtimeId === finalRtId && verify.logicalOffset === 0
  }

  /** P0-VC: measure caret X against the 2em target using the corrected visual start. */
  private emptySpecialCaretGeometry(
    finalElement: HTMLElement,
    projectionMode: EmptyProjectionMode,
  ): EmptyVisualCaretGeometryResult {
    const cs = window.getComputedStyle(finalElement)
    const fontSizePx = parseFloat(cs.fontSize) || 16
    const expectedIndentPx = fontSizePx * 2
    const rect = finalElement.getBoundingClientRect()
    const paragraphRectLeft = rect.left
    const borderInlineStartWidth = parseFloat(cs.borderLeftWidth) || 0
    const paddingInlineStart = parseFloat(cs.paddingLeft) || 0
    const textIndentPx = parseFloat(cs.textIndent) || 0
    const paragraphContentLeft = paragraphRectLeft + borderInlineStartWidth + paddingInlineStart

    const sel = window.getSelection()
    let caretRectLeft = paragraphContentLeft
    if (sel?.rangeCount && sel.isCollapsed) {
      const r = sel.getRangeAt(0).getBoundingClientRect()
      if (r && r.width === 0 && r.height > 0) caretRectLeft = r.left
    }

    return computeEmptyVisualCaretGeometry({
      fontSizePx,
      expectedIndentPx,
      projectionMode,
      paragraphRectLeft,
      borderInlineStartWidth,
      paddingInlineStart,
      textIndentPx,
      caretRectLeft,
      tolerancePx: 4,
      logicalOffset: 0,
    })
  }

  /** P0-VC: whether the effective visual projection matches force-indent 2em. */
  private emptyVisualIndentCorrect(projectionMode: EmptyProjectionMode, cs: CSSStyleDeclaration): boolean {
    const fontSizePx = parseFloat(cs.fontSize) || 16
    const expectedPx = fontSizePx * 2
    const tolerancePx = 4
    if (projectionMode === 'EMPTY_PADDING') {
      const padding = parseFloat(cs.paddingLeft) || 0
      return Math.abs(padding - expectedPx) <= tolerancePx
    }
    if (projectionMode === 'TEXT_INDENT') {
      const indent = cs.textIndent
      if (indent === '2em' || indent === '32px') return true
      const indentPx = parseFloat(indent) || 0
      return Math.abs(indentPx - expectedPx) <= tolerancePx
    }
    return false
  }

  /** P0-AC: roll back a provisional semantic + visual projection on a failed txn. */
  private rollbackEmptySpecialProjection(
    emptyTxn: EmptySpecialCommandTransaction,
    el: HTMLElement,
    recordId: string,
    reason: string,
  ): void {
    clearParagraphIndentVisualAndSemantic(el, WriterIds.EMPTY_SPECIAL_ROLLBACK)
    emitRuntimeAudit('EMPTY-SPECIAL-ROLLBACK', {
      txnId: emptyTxn.txnId,
      recordId,
      recordStateBefore: recordId === 'none' ? 'none' : 'CURRENT_LIVE',
      recordStateAfter: 'none',
      provisionalBefore: true,
      provisionalAfter: false,
      visualProjectionRemoved: true,
      semanticProjectionRemoved: true,
      rehydrateEligibleAfter: false,
      persistableAfter: false,
      sidecarWriteEligibleAfter: false,
      reason,
      overall: true,
    })
  }

  /** P0-AC: remove a just-created canonical record + its in-memory override. */
  private rollbackEmptySpecialCanonical(
    canonical: { recordId: string; decision: 'UPDATE_EXISTING' | 'CREATE' | 'BLOCK' },
    docKey: string,
  ): void {
    // Only a record created by THIS transaction may be removed. UPDATE_EXISTING
    // rebinds a pre-existing record — never delete it on a defensive rollback.
    if (canonical.decision === 'CREATE') {
      const overrides = this.inMemoryOverrides.get(docKey) ?? []
      this.inMemoryOverrides.set(docKey, overrides.filter(o => o.id !== canonical.recordId))
      this.canonicalRegistry.deleteRecord(canonical.recordId)
    }
  }

  /** P0-VC Phase B: read-only BEFORE snapshot for an empty force-indent paragraph. */
  private captureEmptyNonemptyBefore(inputType: string, isComposing: boolean): EmptyNonemptyProjectionBefore | null {
    const skip = (reason: string, extra: Record<string, unknown> = {}): null => {
      emitRuntimeAudit('EMPTY-NONEMPTY-OBSERVER-SKIP', {
        decision: 'SKIP',
        reason,
        phase: 'BEFORE',
        inputType,
        isComposing,
        ...extra,
      })
      return null
    }

    let block: HTMLElement | null = null
    let root: HTMLElement | null = null
    let runtimeId = ''
    try {
      root = this.adapter.getEditorRoot()
      if (!root) return skip('NO_CURRENT_PARAGRAPH')
      block = resolveCurrentBodyParagraph(root)
      if (!block) return skip('NO_CURRENT_PARAGRAPH')

      runtimeId = this.getParagraphRuntimeId(block)
      if (!runtimeId) return skip('NO_RUNTIME_ID')

      const exact = this.canonicalRegistry.resolveExactLiveRecord(block)
      if (!exact) return skip('NO_CURRENT_LIVE_RECORD', { runtimeId })

      const semanticMode = getParagraphIndentMode(block)
      if (semanticMode !== 'force-indent') {
        return skip('SEMANTIC_NOT_FORCE_INDENT', { runtimeId, canonicalRecordId: exact.recordId })
      }

      const visibleText = getUserVisibleParagraphText(block)
      if (visibleText !== '') {
        return skip('BEFORE_NOT_EMPTY', { runtimeId, canonicalRecordId: exact.recordId, visibleTextBefore: visibleText })
      }

      // TS1 Fix2: use safe empty-equivalent classifier (not strict <p></p>).
      const emptyState = classifyObserverEmptyEquivalent(block)
      emitRuntimeAudit('EMPTY-NONEMPTY-OBSERVER-BEFORE-DOM', {
        inputType,
        isComposing,
        runtimeId,
        canonicalRecordId: exact.recordId,
        canonicalState: 'CURRENT_LIVE',
        generation: exact.meta.generation,
        semanticMode,
        visibleText,
        rawTextContent: block.textContent ?? '',
        tagName: block.tagName.toLowerCase(),
        innerHTML: block.innerHTML,
        childNodeCount: block.childNodes.length,
        childNodeSummaries: Array.from(block.childNodes).map(n => n.nodeType === 3 ? `text:${(n.textContent ?? '').slice(0, 24)}` : n instanceof Element ? `tag:${n.tagName.toLowerCase()}` : `node:${n.nodeType}`),
        elementChildCount: block.children.length,
        textNodeCount: Array.from(block.childNodes).filter(n => n.nodeType === 3).length,
        hasBR: block.querySelector('br') !== null,
        brCount: block.querySelectorAll('br').length,
        hasMdPlainSpan: block.querySelector('span[md-inline="plain"].md-plain.md-expand') !== null,
        hasPlaceholderSpan: block.querySelector('span[data-placeholder], span.placeholder, span.md-empty') !== null,
        hasTyporaMarker: block.querySelector('[class*="md-"], [class*="cm-"]') !== null,
        hasContentEditableMarker: block.hasAttribute('contenteditable'),
        computedTextIndent: window.getComputedStyle(block).textIndent,
        computedPaddingInlineStart: window.getComputedStyle(block).paddingLeft,
        strictNativeEmpty: emptyState.strictNativeEmpty,
        safeEmptyEquivalent: emptyState.safeEmptyEquivalent,
        emptyEquivalentReason: emptyState.reason ?? 'none',
      })

      const armReason = classifyObserverArmReason(
        semanticMode,
        visibleText,
        exact.recordId,
        emptyState.safeEmptyEquivalent,
      )
      if (armReason) {
        return skip(armReason, {
          runtimeId,
          canonicalRecordId: exact.recordId,
          visibleTextBefore: visibleText,
          emptyEquivalentReason: emptyState.reason ?? 'none',
        })
      }

      const cs = window.getComputedStyle(block)
      const rect = block.getBoundingClientRect()
      const truth = resolveSelectionTruth(root, (el: object) => this.getParagraphRuntimeId(el as HTMLElement), 'EMPTY-NONEMPTY-BEFORE')

      const before: EmptyNonemptyProjectionBefore = {
        runtimeId,
        canonicalRecordId: exact.recordId,
        generation: exact.meta.generation,
        semanticMode,
        visibleText,
        isNativeEmpty: emptyState.strictNativeEmpty,
        safeEmptyEquivalent: emptyState.safeEmptyEquivalent,
        emptyEquivalentReason: emptyState.reason ?? null,
        paddingInlineStartPx: parseFloat(cs.paddingLeft) || 0,
        textIndentPx: parseFloat(cs.textIndent) || 0,
        fontSizePx: parseFloat(cs.fontSize) || 16,
        paragraphRectLeft: rect.left,
        borderInlineStartWidth: parseFloat(cs.borderLeftWidth) || 0,
        selectionRuntimeId: truth?.runtimeId ?? null,
        logicalOffset: truth?.logicalOffset ?? 0,
      }

      emitRuntimeAudit('EMPTY-NONEMPTY-OBSERVER-ARM', {
        decision: 'ARMED',
        inputType,
        isComposing,
        runtimeId,
        canonicalRecordId: exact.recordId,
        canonicalState: 'CURRENT_LIVE',
        generation: exact.meta.generation,
        semanticMode: 'force-indent',
        visibleTextBefore: visibleText,
        strictNativeEmpty: emptyState.strictNativeEmpty,
        safeEmptyEquivalent: emptyState.safeEmptyEquivalent,
        emptyEquivalentReason: emptyState.reason ?? 'none',
        paddingBeforePx: before.paddingInlineStartPx,
        textIndentBeforePx: before.textIndentPx,
      })

      return before
    } catch (e) {
      return skip('BEFORE_READ_FAILED', { runtimeId, error: String(e) })
    }
  }

  /** P0-VC Phase B: read-only first-glyph rect via a temporary DOM Range (never writes Selection). */
  private readFirstGlyphRectLeft(block: HTMLElement): number {
    try {
      const walker = document.createTreeWalker(block, NodeFilter.SHOW_TEXT)
      let node: Node | null = walker.nextNode()
      while (node) {
        if ((node.textContent ?? '') !== '') {
          const range = document.createRange()
          range.setStart(node, 0)
          range.setEnd(node, 1)
          const r = range.getBoundingClientRect()
          if (r && r.width > 0) return r.left
        }
        node = walker.nextNode()
      }
    } catch { /* ignore */ }
    return block.getBoundingClientRect().left
  }

  /** P0-VC Phase B: emit the empty→nonempty transition event (fail-open, read-only). */
  private emitEmptyNonemptyTransitionIfPending(root: HTMLElement): void {
    const before = this.pendingEmptyNonemptyBefore
    this.pendingEmptyNonemptyBefore = null
    if (!before) return

    const skipAfter = (reason: string, extra: Record<string, unknown> = {}): void => {
      emitRuntimeAudit('EMPTY-NONEMPTY-OBSERVER-SKIP', {
        decision: 'SKIP',
        reason,
        phase: 'AFTER',
        runtimeIdBefore: before.runtimeId,
        ...extra,
      })
    }

    try {
      const block = resolveCurrentBodyParagraph(root)
      if (!block) {
        skipAfter('NO_CURRENT_PARAGRAPH')
        return
      }
      const exact = this.canonicalRegistry.resolveExactLiveRecord(block)
      const cs = window.getComputedStyle(block)
      const rect = block.getBoundingClientRect()
      const truth = resolveSelectionTruth(root, (el: object) => this.getParagraphRuntimeId(el as HTMLElement), 'EMPTY-NONEMPTY-AFTER')
      const afterEmptyState = classifyObserverEmptyEquivalent(block)

      const after: EmptyNonemptyProjectionAfter = {
        runtimeId: this.getParagraphRuntimeId(block),
        canonicalRecordId: exact?.recordId ?? '',
        generation: exact?.meta.generation ?? before.generation,
        semanticMode: getParagraphIndentMode(block) === 'force-indent' ? 'force-indent' : 'auto',
        visibleText: getUserVisibleParagraphText(block),
        isNativeEmpty: isNativeEmptyParagraph(block),
        safeEmptyEquivalent: afterEmptyState.safeEmptyEquivalent,
        emptyEquivalentReason: afterEmptyState.reason ?? null,
        paddingInlineStartPx: parseFloat(cs.paddingLeft) || 0,
        textIndentPx: parseFloat(cs.textIndent) || 0,
        fontSizePx: parseFloat(cs.fontSize) || 16,
        paragraphRectLeft: rect.left,
        borderInlineStartWidth: parseFloat(cs.borderLeftWidth) || 0,
        firstGlyphRectLeft: this.readFirstGlyphRectLeft(block),
        selectionRuntimeId: truth?.runtimeId ?? null,
        logicalOffset: truth?.logicalOffset ?? 0,
        pluginSelectionWriteCount: this.pluginSelectionWriteCount,
        caretContinuityRestoreCount: this.caretContinuityRestoreCount,
        caretRepairCount: this.caretRepairCount,
      }

      emitRuntimeAudit('EMPTY-NONEMPTY-OBSERVER-AFTER', {
        runtimeIdBefore: before.runtimeId,
        runtimeIdAfter: after.runtimeId,
        canonicalRecordIdBefore: before.canonicalRecordId,
        canonicalRecordIdAfter: after.canonicalRecordId,
        generationBefore: before.generation,
        generationAfter: after.generation,
        visibleTextBefore: before.visibleText,
        visibleTextAfter: after.visibleText,
        isNativeEmptyBefore: before.isNativeEmpty,
        isNativeEmptyAfter: after.isNativeEmpty,
        safeEmptyEquivalentBefore: before.safeEmptyEquivalent ?? false,
        safeEmptyEquivalentAfter: after.safeEmptyEquivalent ?? false,
        emptyEquivalentReasonBefore: before.emptyEquivalentReason ?? 'none',
        semanticBefore: before.semanticMode,
        semanticAfter: after.semanticMode,
        paddingBeforePx: before.paddingInlineStartPx,
        paddingAfterPx: after.paddingInlineStartPx,
        textIndentBeforePx: before.textIndentPx,
        textIndentAfterPx: after.textIndentPx,
        selectionRuntimeId: after.selectionRuntimeId,
        logicalOffset: after.logicalOffset,
      })

      // Only the empty→nonempty transition qualifies.
      const beforeEmpty = before.safeEmptyEquivalent ?? before.isNativeEmpty
      if (!beforeEmpty || afterEmptyState.safeEmptyEquivalent) {
        skipAfter('AFTER_STILL_EMPTY', { runtimeIdAfter: after.runtimeId })
        return
      }

      const report = evaluateEmptyNonemptyProjectionTransition(before, after)
      emitRuntimeAudit('EMPTY-NONEMPTY-PROJECTION-TRANSITION', {
        ...report,
        strictNativeEmptyBefore: before.isNativeEmpty,
        strictNativeEmptyAfter: after.isNativeEmpty,
      })
    } catch (e) {
      skipAfter('AFTER_READ_FAILED', { error: String(e) })
    }
  }

  private finishEmptySpecialBlocked(emptyTxn: EmptySpecialCommandTransaction, reason: string): void {
    this.closeEmptySpecialTransaction(emptyTxn, 'BLOCKED')
    emitRuntimeAudit('EMPTY-SPECIAL-FINAL', {
      txnId: emptyTxn.txnId,
      sourceWasTokenOnly: true,
      overall: false,
      blockedReason: reason,
    })
    logger.info(`EMPTY-SPECIAL-BLOCKED: txnId=${emptyTxn.txnId} reason=${reason}`)
  }

  /** P0-B: TIMEOUT_BLOCK — timeout is NEVER a success fallback; no canonical/caret mutation. */
  private finishEmptySpecialTimeoutBlock(emptyTxn: EmptySpecialCommandTransaction): void {
    this.closeEmptySpecialTransaction(emptyTxn, 'TIMEOUT_BLOCK')
    emitRuntimeAudit('EMPTY-SPECIAL-FINAL', {
      txnId: emptyTxn.txnId,
      sourceWasTokenOnly: true,
      overall: false,
      blockedReason: 'TIMEOUT_BLOCK',
      canonicalCommitAttempted: false,
      canonicalRebindAttempted: false,
      caretWriteAttempted: false,
    })
    logger.info(`EMPTY-SPECIAL-TIMEOUT-BLOCK: txnId=${emptyTxn.txnId}`)
  }

  /** E: Intent supersession — BLOCK the stale txn before any mutation, with full audit. */
  private finishEmptySpecialSuperseded(emptyTxn: EmptySpecialCommandTransaction): void {
    this.closeEmptySpecialTransaction(emptyTxn, 'SUPERSEDED')
    emitRuntimeAudit('EMPTY-SPECIAL-SUPERSESSION-AUDIT', {
      txnId: emptyTxn.txnId,
      oldEpoch: emptyTxn.intentEpoch,
      newEpoch: this.userIntentEpoch,
      newSource: this.lastUserIntentSource || 'unknown',
      mutationAttempted: false,
      canonicalCommitAttempted: false,
      caretWriteAttempted: false,
      decision: 'SUPERSEDE',
    })
    emitRuntimeAudit('EMPTY-SPECIAL-FINAL', {
      txnId: emptyTxn.txnId,
      sourceWasTokenOnly: true,
      overall: false,
      blockedReason: 'INTENT_SUPERSEDED',
    })
    logger.info(`EMPTY-SPECIAL-SUPERSEDED: txnId=${emptyTxn.txnId} oldEpoch=${emptyTxn.intentEpoch} newEpoch=${this.userIntentEpoch}`)
  }

  /** A: Emit a read-only empty-block DOM snapshot into the JSONL audit. */
  private emitEmptyBlockDomSnapshot(phase: string, node: Node | null, runtimeId: string | null): EmptyBlockDomSnapshot {
    const snap = snapshotEmptyBlockDom(node, phase, runtimeId)
    emitRuntimeAudit('EMPTY-BLOCK-DOM-SNAPSHOT', {
      phase: snap.phase,
      runtimeId: snap.runtimeId ?? 'none',
      isConnected: snap.isConnected,
      tagName: snap.tagName,
      innerHTML: snap.innerHTML,
      textContent: snap.textContent,
      childNodeCount: snap.childNodeCount,
      childNodeSummaries: snap.childNodeSummaries,
      hasBR: snap.hasBR,
      brCount: snap.brCount,
      hasPlaceholderSpan: snap.hasPlaceholderSpan,
      hasTyporaMarker: snap.hasTyporaMarker,
    })
    return snap
  }

  /** A: Find a reference native-empty paragraph (prev → next → any other empty). */
  private findNativeEmptyReferenceParagraph(
    sourceEl: HTMLElement,
    prevEl: HTMLElement | null,
    nextEl: HTMLElement | null,
    allParas: HTMLElement[],
  ): HTMLElement | null {
    if (prevEl && getUserVisibleParagraphText(prevEl) === '') return prevEl
    if (nextEl && getUserVisibleParagraphText(nextEl) === '') return nextEl
    for (const p of allParas) {
      if (p !== sourceEl && getUserVisibleParagraphText(p) === '') return p
    }
    return null
  }

  /** Synchronous atomic commit — all steps in one call stack. */
  private commitEnterIndentTransactionSync(txn: EnterIndentTransaction, event: Event): void {
    const para = txn.paragraph
    // P0: token-only empty paragraph ("。。" and nothing else) requires the
    // deferred empty-special-command flow. Ordinary non-empty path is unchanged.
    if (isTokenOnlyEmptySpecialCommand(getUserVisibleParagraphText(para), txn.token)) {
      this.commitEmptySpecialTransactionSync(txn, event, para)
      return
    }
    // r57: Use stable object-identity runtime ID, NOT mutable class/text fingerprint.
    const commandRuntimeId = this.getParagraphRuntimeId(para)
    const preParagraphConnected = para.isConnected
    txn.traceData['T0_paraCountBefore'] = txn.paragraphCountBefore
    txn.traceData['T0_paraTag'] = para.tagName

    // ── r56: Pre-cursor global offset (diagnostic only, NOT for success) ──
    const globalCursorBefore = this.ctx.getCursorOffset?.() ?? null
    txn.traceData['globalCursorBefore'] = globalCursorBefore

    // consume Enter
    event.preventDefault()
    event.stopPropagation()
    txn.traceData['preventDefault'] = true
    txn.state = 'token-consumed'

    // consume token — direct DOM textContent mutation
    this.clearParagraphToken(para, txn.token)
    txn.tokenConsumed = true
    txn.traceData['tokenConsumed'] = true
    txn.traceData['tokenConsumerType'] = 'direct-textNode-mutation'

    // ── r56: Resolve final command target (A or unique replacement A') ──
    const postTokenConnected = para.isConnected
    let finalCommandTarget: HTMLElement | null = para

    if (!postTokenConnected) {
      logger.info(`STALE-PARAGRAPH-AFTER-TOKEN-CONSUME: txnId=${txn.id}`)
      txn.traceData['staleDetected'] = true
      const currentRoot = this.adapter.getEditorRoot()
      if (currentRoot) {
        const allParas = collectContentParagraphs(currentRoot)
        const paraOrdinal = txn.paragraphCountBefore > 0
          ? Math.min(txn.paragraphCountBefore - 1, allParas.length - 1)
          : 0
        if (paraOrdinal >= 0 && paraOrdinal < allParas.length) {
          finalCommandTarget = allParas[paraOrdinal]
          txn.traceData['replacementUsed'] = true
        }
      }
    }

    // semantic FORCE_INDENT
    setParagraphIndentMode(finalCommandTarget, 'force-indent', WriterIds.ENTER_COMMIT_SEMANTIC)
    txn.semanticWritten = true
    txn.state = 'semantic-written'

    // ── R58.2: Canonical sidecar record with live binding via registry ──────
    // Uses canonicalCreateOrReuseForEnter — the ONLY path that allows CREATE_NEW.
    const docKey = this.getDocumentKey()
    const docPath = this.ctx.getActiveFilePath?.() ?? 'unknown'
    const recordCountBefore = (this.inMemoryOverrides.get(docKey ?? '') ?? []).length
    const sidecarResult = this.canonicalCreateOrReuseForEnter(
      finalCommandTarget, 'force-indent', txn.id,
      this.getParagraphRuntimeId(finalCommandTarget),
      docKey ?? '', docPath,
    )
    txn.sidecarWritten = true
    txn.traceData['sidecarWriteCount'] = 1
    txn.traceData['sidecarCanonicalRecordCreated'] = true

    const afterRecords = this.inMemoryOverrides.get(docKey ?? '') ?? []
    const recordCountAfter = afterRecords.length
    const recordId = sidecarResult.recordId

    // CANONICAL-RECORD-COMMIT trace
    console.info(
      `[InkChapter] CANONICAL-RECORD-COMMIT: txnId=${txn.id} ` +
      `recordId=${recordId} ` +
      `operation=${sidecarResult.decision} ` +
      `recordCountBefore=${recordCountBefore} recordCountAfter=${recordCountAfter} ` +
      `mode=FORCE_INDENT temporary=true ` +
      `boundRuntimeId=${commandRuntimeId} ` +
      `duplicateAppendDetected=${sidecarResult.decision === 'CREATE_NEW' && recordCountAfter > recordCountBefore + 1}`,
    )
    txn.traceData['canonicalRecordId'] = recordId
    txn.traceData['canonicalRecordCountBefore'] = recordCountBefore
    txn.traceData['canonicalRecordCountAfter'] = recordCountAfter

    // visual projection
    const settings = this.getParagraphLayoutSettings()
    const structural = { isFormulaContinuation: settings.flushAfterDisplayMath ? isAfterDisplayMath(finalCommandTarget) : false }
    const effective = resolveEffectiveParagraphIndent('force-indent', settings.defaultIndent, structural)
    applyEffectiveParagraphIndent(finalCommandTarget, effective, WriterIds.ENTER_COMMIT_VISUAL)
    txn.state = 'visual-applied'
    txn.traceData['computedIndent'] = window.getComputedStyle(finalCommandTarget).textIndent

    // ── r57: VERIFY-FIRST Caret ──────────────────────────────────
    // After token consume + semantic + visual, check if Typora already
    // placed the caret correctly. Only repair if mismatch.
    const rootAfterVisual = this.adapter.getEditorRoot()
    const doc = finalCommandTarget.ownerDocument
    const sel = doc?.defaultView?.getSelection() ?? null

    // POST-TOKEN-SELECTION: resolve current selection against command target
    const postTokenRes = resolveSelectionParagraph(
      sel,
      rootAfterVisual ?? finalCommandTarget,
      (el: object) => this.getParagraphRuntimeId(el as HTMLElement),
    )

    const alreadyCorrect =
      postTokenRes.paragraphRuntimeId === commandRuntimeId &&
      (postTokenRes.localLogicalOffset ?? -1) === 0

    let repairResult: CaretRepairResult | null = null

    if (alreadyCorrect) {
      // Typora already has caret in correct position — do NOT write
      txn.traceData['caretWriteAttempted'] = false
      txn.traceData['caretSuccess'] = true
      txn.traceData['caretRepairAttempted'] = false
    } else {
      // Mismatch — repair needed
      txn.traceData['caretWriteAttempted'] = true
      repairResult = repairCaretAtParagraphLogicalStart(
        finalCommandTarget,
        rootAfterVisual ?? finalCommandTarget,
        commandRuntimeId,
        (el: object) => this.getParagraphRuntimeId(el as HTMLElement),
      )
      this.recordPluginSelectionWrite(
        `write-${commandRuntimeId}-${Date.now()}`,
        'CARET-REPAIR',
        'POST-TOKEN-SELECTION',
        commandRuntimeId,
        postTokenRes.localLogicalOffset ?? null,
        0,
        repairResult.success,
      )
      txn.traceData['caretSuccess'] = repairResult.success
      txn.traceData['caretRepairAttempted'] = true
      txn.traceData['caretRepairMethod'] = repairResult.method
      txn.traceData['caretRepairTextLeafFound'] = repairResult.textLeafFound
    }

    // Diagnostic global cursor readback (NOT used for success)
    const globalCursorAfter = this.ctx.getCursorOffset?.() ?? null
    txn.traceData['globalCursorAfter'] = globalCursorAfter

    // POST-TOKEN-SELECTION trace
    const postTokenSelection: PostTokenSelectionResult = {
      txnId: txn.id,
      commandRuntimeId,
      anchorNodeType: postTokenRes.anchorNodeType,
      anchorNodeName: postTokenRes.anchorNodeName,
      resolvedParagraphRuntimeId: postTokenRes.paragraphRuntimeId ?? null,
      resolvedParagraphOrdinal: postTokenRes.paragraphOrdinal,
      localLogicalOffset: postTokenRes.localLogicalOffset,
      sameAsCommandTarget: postTokenRes.paragraphRuntimeId === commandRuntimeId,
      alreadyCorrect,
      repairAttempted: repairResult !== null,
      caretWriteAttempted: !alreadyCorrect,
      caretSuccess: alreadyCorrect || (repairResult?.success ?? false),
    }
    txn.traceData['POST-TOKEN-SELECTION'] = postTokenSelection
    console.info(
      `[InkChapter] POST-TOKEN-SELECTION: txnId=${txn.id} ` +
      `commandRuntimeId=${commandRuntimeId} ` +
      `resolvedRuntimeId=${postTokenRes.paragraphRuntimeId ?? 'null'} ` +
      `anchorOffset=${postTokenRes.localLogicalOffset} ` +
      `sameAsCommand=${postTokenRes.paragraphRuntimeId === commandRuntimeId} ` +
      `alreadyCorrect=${alreadyCorrect} ` +
      `caretWriteAttempted=${postTokenSelection.caretWriteAttempted} ` +
      `caretSuccess=${postTokenSelection.caretSuccess}`,
    )

    txn.state = 'caret-restored'
    txn.state = 'committed'
    txn.suppressNativeInsertParagraph = true

    const finalRoot = this.adapter.getEditorRoot()
    const paragraphCountAfter = finalRoot ? collectContentParagraphs(finalRoot).length : -1
    txn.traceData['paragraphCountAfter'] = paragraphCountAfter
    const paragraphCountSuccess = paragraphCountAfter === txn.paragraphCountBefore

    const semanticAfter = finalCommandTarget ? getParagraphIndentMode(finalCommandTarget) : 'unknown'
    const computedIndentAfter = finalCommandTarget ? window.getComputedStyle(finalCommandTarget).textIndent : 'unknown'

    // ── r57: ENTER-COMMIT-ATOMIC with runtime-ID-based success ──
    const caretSuccess = alreadyCorrect || (repairResult?.success ?? false)
    const successFields: EnterCommitSuccessFields = {
      tokenSuccess: txn.tokenConsumed,
      semanticSuccess: txn.semanticWritten && semanticAfter === 'force-indent',
      visualSuccess: computedIndentAfter === '32px',
      caretSuccess,
      overallSuccess: false,
    }
    ;(successFields as any).paragraphCountSuccess = paragraphCountSuccess
    ;(successFields as any).sameParagraphSuccess = postTokenRes.paragraphRuntimeId === commandRuntimeId
    ;(successFields as any).localOffsetSuccess = (postTokenRes.localLogicalOffset ?? -1) === 0
    ;(successFields as any).globalCursorBefore = globalCursorBefore
    ;(successFields as any).globalCursorAfter = globalCursorAfter
    successFields.overallSuccess =
      successFields.tokenSuccess &&
      paragraphCountSuccess &&
      successFields.semanticSuccess &&
      successFields.visualSuccess &&
      successFields.caretSuccess &&
      postTokenRes.paragraphRuntimeId === commandRuntimeId &&
      (postTokenRes.localLogicalOffset ?? -1) === 0

    txn.traceData['successFields'] = successFields
    txn.traceData['stopReason'] = 'commit completed'

    logger.info(`ENTER-COMMIT-ATOMIC: txnId=${txn.id} tokenSuccess=${successFields.tokenSuccess} paragraphCountSuccess=${paragraphCountSuccess} semanticSuccess=${successFields.semanticSuccess} visualSuccess=${successFields.visualSuccess} caretSuccess=${successFields.caretSuccess} sameParagraph=${postTokenRes.paragraphRuntimeId === commandRuntimeId} localOffset=${postTokenRes.localLogicalOffset} overallSuccess=${successFields.overallSuccess}`)
    logger.info(`${txn.id} committed: token=${txn.token}`)

    // ── R58.6.6: Create CaretExpectation for special command ──
    const docKeyExpect = this.getDocumentKey() ?? ''
    const expectEl = finalCommandTarget
    const expectRtId = this.getParagraphRuntimeId(expectEl)
    this.activeCaretExpectation = {
      expectationId: `ce-${txn.id}`,
      documentKey: docKeyExpect,
      scopeId: this.documentContext.scopeId ?? 'unknown',
      expectedElement: expectEl,
      expectedRuntimeId: expectRtId,
      expectedLogicalOffset: 0,
      canonicalRecordId: recordId,
      generation: 1,
      reason: 'SPECIAL_COMMAND_CURRENT_PARAGRAPH',
      createdAt: Date.now(),
      active: true,
      restoreAttempts: 0,
      intentEpoch: this.userIntentEpoch,
    }
    console.info(
      `[InkChapter] CARET-EXPECTATION-CREATE: ` +
      `expectationId=${this.activeCaretExpectation.expectationId} ` +
      `scopeId=${this.activeCaretExpectation.scopeId} ` +
      `reason=SPECIAL_COMMAND_CURRENT_PARAGRAPH ` +
      `intentEpoch=${this.userIntentEpoch} ` +
      `expectedRuntimeId=${expectRtId} ` +
      `expectedLogicalOffset=0 ` +
      `canonicalRecordId=${recordId} ` +
      `generation=1 ` +
      `decision=ACTIVE`,
    )
    // R58.6.6: Verify + optional one-shot restore
    const expectRef2 = this.activeCaretExpectation!
    queueMicrotask(() => {
      if (!expectRef2.active) return
      // R58.7: Scope guard — SCOPE_CHANGED before intentEpoch
      if (expectRef2.scopeId !== this.documentContext.scopeId) {
        console.info(
          `[InkChapter] CARET-EXPECTATION-CLOSE: ` +
          `expectationId=${expectRef2.expectationId} ` +
          `reason=SCOPE_CHANGED ` +
          `expectationScopeId=${expectRef2.scopeId} ` +
          `currentScopeId=${this.documentContext.scopeId ?? 'null'} ` +
          `restoreAttempted=false`,
        )
        expectRef2.active = false
        this.activeCaretExpectation = null
        return
      }
      const r = this.adapter.getEditorRoot()
      if (!r) return
      const v = verifyCaretExpectation(expectRef2, r, (el: object) => this.getParagraphRuntimeId(el as HTMLElement), 'MICROTASK')
      if (!v.verified && expectRef2.restoreAttempts < 1 && this.userIntentEpoch === expectRef2.intentEpoch) {
        const contentChanged = expectRef2.expectedTextContent !== undefined &&
          getUserVisibleParagraphText(expectRef2.expectedElement) !== expectRef2.expectedTextContent
        if (contentChanged) {
          console.info(
            `[InkChapter] CARET-RESTORE-BLOCK: ` +
            `expectationId=${expectRef2.expectationId} ` +
            `reason=CONTENT_CHANGED_AFTER_EXPECTATION ` +
            `decision=BLOCK`,
          )
          expectRef2.active = false
          this.activeCaretExpectation = null
        } else {
          const restoreBefore = resolveSelectionTruth(r, (el: object) => this.getParagraphRuntimeId(el as HTMLElement), 'CARET-RESTORE-BEFORE')
          const restoreResult = restoreLogicalCaret(expectRef2, r, (el: object) => this.getParagraphRuntimeId(el as HTMLElement))
          this.recordPluginSelectionWrite(
            `restore-${expectRef2.expectationId}-${Date.now()}`,
            'CARET-CONTINUITY-RESTORE',
            expectRef2.reason,
            expectRef2.expectedRuntimeId,
            restoreBefore.logicalOffset ?? null,
            expectRef2.expectedLogicalOffset,
            restoreResult.success,
          )
        }
      }
    })
    requestAnimationFrame(() => {
      if (!expectRef2.active) return
      const r = this.adapter.getEditorRoot()
      if (!r) return
      verifyCaretExpectation(expectRef2, r, (el: object) => this.getParagraphRuntimeId(el as HTMLElement), 'RAF')
    })

    // ── P0-5: One-Shot Paragraph Replacement Handoff ────────────────
    const rootAfter = this.adapter.getEditorRoot()
    const allParasAfter = rootAfter ? collectContentParagraphs(rootAfter) : []
    const paraOrdinal2 = allParasAfter.indexOf(para) >= 0
      ? allParasAfter.indexOf(para)
      : txn.paragraphCountBefore > 0 ? Math.min(txn.paragraphCountBefore - 1, allParasAfter.length - 1) : 0

    this.activeOneShotHandoff = {
      handoffId: `handoff-${txn.id}`,
      sourceTxnId: txn.id,
      canonicalRecordId: recordId,
      scopeId: txn.scopeRef?.scopeId ?? this.documentContext.scopeId ?? 'unknown',
      preElement: para,
      preOrdinal: paraOrdinal2,
      preIdentity: commandRuntimeId,
      tokenConsumed: txn.tokenConsumed,
      semantic: 'force-indent',
      semanticAtCreation: 'force-indent',
      preRuntimeId: commandRuntimeId,
      consumed: false,
      replacementResolved: false,
      replacementElement: null,
      replacementOrdinal: null,
      replacementIdentity: null,
      semanticTransferred: false,
      visualTransferred: false,
    }

    console.info(
      `[InkChapter] HANDOFF-CREATE: ` +
      `handoffId=${this.activeOneShotHandoff.handoffId} ` +
      `scopeId=${this.activeOneShotHandoff.scopeId} ` +
      `intentEpoch=${this.userIntentEpoch} ` +
      `canonicalRecordId=${recordId} ` +
      `preRuntimeId=${commandRuntimeId} ` +
      `decision=ACTIVE`,
    )

    this.scheduleTransactionStabilitySnapshots(txn)
    this.installDiagnosticMutationObserver(txn)
  }

  /**
   * T0-T4 stability verification within the transaction window.
   * Transaction closes at T4_150ms.
   * PostCommitObservationSession takes over from T4_150ms to T9_2000ms.
   */
  private scheduleTransactionStabilitySnapshots(txn: EnterIndentTransaction): void {
    const snap = (label: string) => {
      if (txn.state === 'closed') return
      const para = txn.paragraph
      const root = this.adapter.getEditorRoot()
      const lastWriter = getLastParagraphWriter(para)
      const data: Record<string, unknown> = {
        txnId: txn.id, label,
        transactionActive: true,
        paraCount: root ? collectContentParagraphs(root).length : -1,
        DOMtext: getUserVisibleParagraphText(para),
        semantic: getParagraphIndentMode(para),
        computedIndent: window.getComputedStyle(para).textIndent,
        caretInPara: window.getSelection()?.rangeCount ? para.contains(window.getSelection()!.getRangeAt(0).startContainer) : false,
        effectiveClass_indent2: para.classList.contains('inkchapter-paragraph-effective-indent-2'),
        effectiveClass_flush: para.classList.contains('inkchapter-paragraph-effective-flush'),
        dataAttr: para.getAttribute('data-inkchapter-indent-mode'),
        lastWriterId: lastWriter?.writerId ?? null,
        lastWriterReason: lastWriter?.reason ?? null,
        lastWriterTime: lastWriter?.timestamp ?? null,
        txnState: txn.state,
        paragraphIsConnected: para.isConnected,
        paragraphTextContent: para.textContent?.slice(0, 80) ?? '',
        userVisibleText: getUserVisibleParagraphText(para),
      }
      data['tokenGone'] = data['DOMtext'] === ''
      data['sameParagraphCount'] = data['paraCount'] === txn.paragraphCountBefore
      txn.traceData[label] = data
      logger.info(`${txn.id} ${label}: tokenGone=${data['tokenGone']} countMatch=${data['sameParagraphCount']} txActive=true`)
    }

    // T0 = sync end (already captured in commitEnterIndentTransactionSync)
    // T1 = microtask
    queueMicrotask(() => { snap('T1_microtask') })
    // T2 = next RAF
    requestAnimationFrame(() => { snap('T2_RAF') })
    // T3 = 50ms
    setTimeout(() => { snap('T3_50ms') }, 50)
    // T4 = 150ms → close transaction, start observation
    setTimeout(() => {
      snap('T4_150ms')
      const closeTime = performance.now()
      this.activeEnterTransaction = null
      txn.state = 'closed'
      logger.info(`${txn.id} TRANSACTION CLOSED at ~${Math.round(closeTime - txn.startedAt)}ms`)
      
      // Start independent PostCommitObservationSession
      this.startPostCommitObservation(txn, closeTime)
    }, 150)
  }

  /** Flush race trace data to JSONL file. */
  private flushEnterRaceTrace(traceData: Record<string, unknown>): void {
    try {
      const fs = require('fs') as typeof import('fs')
      const path = require('path') as typeof import('path')
      const vaultRoot = (this.ctx as any).vaultRoot ??
        (this.ctx.settings as any).getVaultRoot?.() ?? ''
      const tracePath = path.join(
        vaultRoot || path.dirname(this.getActiveFilePath() || ''),
        '.typora',
        'inkchapter-enter-race-trace.jsonl',
      )
      fs.appendFileSync(tracePath, JSON.stringify(traceData) + '\n', 'utf8')
    } catch { /* fail-open */ }
  }

  // ── Post-Commit Observation ────────────────────────────────────────
  // COMPLETELY READ-ONLY. Never modifies DOM, semantic, class, style,
  // sidecar, caret, or any business state. Only traces for diagnosis.
  //
  // Observation continues after transaction closes, up to T9=2000ms.
  // Records all paragraph state mutations including those from async
  // writers (refresh, rehydrate, settings, sidecar, etc.).

  /**
   * Start a read-only observation session that continues after transaction close.
   * Runs T4→T9 with transactionActive=false, recording all state changes.
   */
  private startPostCommitObservation(txn: EnterIndentTransaction, closedAt: number): void {
    const obs: PostCommitObservationSession = {
      observationId: `obs-${txn.id}`,
      txnId: txn.id,
      paragraphAtCommit: txn.paragraph,
      paragraphIdentityAtCommit: getElementIdentity(txn.paragraph),
      startedAt: performance.now(),
      transactionClosedAt: closedAt,
      lastKnownParagraph: txn.paragraph,
      mutationObserver: null,
      traceData: { ...txn.traceData, observationId: `obs-${txn.id}`, observationStartedAt: performance.now(), transactionClosedAt: closedAt },
    }
    this.observations.set(obs.observationId, obs)

    // Migrate diagnostic MutationObserver from transaction to observation session
    const diagnosticObserver = (txn as any)._diagnosticObserver as MutationObserver | undefined
    if (diagnosticObserver) {
      obs.mutationObserver = diagnosticObserver
      delete (txn as any)._diagnosticObserver
    }

    const snapObs = (label: string) => {
      if (!this.observations.has(obs.observationId)) return
      const para = obs.lastKnownParagraph

      // ── P0-B: Three independent targets ────────────────────────────
      // COMMAND TARGET: the original paragraph at commit time
      // CONTINUITY TARGET: the handoff replacement (if resolved)
      // SELECTION TARGET: current cursor/selection position (diagnostic only)

      // --- COMMAND TARGET ---
      const commandConnected = para?.isConnected ?? false
      const commandSemantic = para ? getParagraphIndentMode(para) : null
      const commandIndent = para ? window.getComputedStyle(para).textIndent : null

      const obsCommand: Record<string, unknown> = {
        txnId: obs.txnId,
        originalConnected: commandConnected,
        originalOrdinal: txn.paragraphCountBefore,
        originalIdentity: obs.paragraphIdentityAtCommit,
        originalSemantic: commandSemantic,
        originalIndent: commandIndent,
      }

      // --- CONTINUITY TARGET ---
      const handoff = this.activeOneShotHandoff
      const obsContinuity: Record<string, unknown> = {
        handoffExists: !!handoff,
        handoffConsumed: handoff?.consumed ?? false,
        replacementKnown: handoff?.replacementResolved ?? false,
        replacementConnected: handoff?.replacementElement?.isConnected ?? false,
        replacementOrdinal: handoff?.replacementOrdinal ?? null,
        replacementIdentity: handoff?.replacementIdentity ?? null,
        replacementSemantic: handoff?.replacementElement ? getParagraphIndentMode(handoff.replacementElement) : null,
        replacementIndent: handoff?.replacementElement ? window.getComputedStyle(handoff.replacementElement).textIndent : null,
        semanticTransferred: handoff?.semanticTransferred ?? false,
        visualTransferred: handoff?.visualTransferred ?? false,
      }

      // --- SELECTION TARGET — R58.6.4: Unified SelectionTruth ──
      const selTruth = resolveSelectionTruth(
        this.adapter.getEditorRoot() ?? document.body,
        (el: object) => this.getParagraphRuntimeId(el as HTMLElement),
        'OBS',
      )
      const expectedRtId = handoff?.replacementElement
        ? this.getParagraphRuntimeId(handoff.replacementElement)
        : this.getParagraphRuntimeId(obs.lastKnownParagraph!)
      const sameAsCommand = selTruth.runtimeId !== null && selTruth.runtimeId === expectedRtId
      const obsSelection: Record<string, unknown> = {
        selectionParagraphRuntimeId: selTruth.runtimeId,
        selectionParagraphOrdinal: selTruth.ordinal,
        selectionLocalOffset: selTruth.logicalOffset,
        sameAsCommandTarget: sameAsCommand,
        sameAsContinuityTarget: handoff?.replacementElement && selTruth.runtimeId ? (selTruth.runtimeId === this.getParagraphRuntimeId(handoff.replacementElement)) : false,
      }

      obs.traceData[`OBS-COMMAND-${label}`] = obsCommand
      obs.traceData[`OBS-CONTINUITY-${label}`] = obsContinuity
      obs.traceData[`OBS-SELECTION-${label}`] = obsSelection

      logger.info(`OBS-COMMAND ${label}: originalConnected=${commandConnected} originalSemantic=${commandSemantic}`)
      logger.info(`OBS-CONTINUITY ${label}: handoffExists=${obsContinuity['handoffExists']} replacementSemantic=${obsContinuity['replacementSemantic']}`)
      logger.info(`OBS-SELECTION ${label}: runtimeId=${selTruth.runtimeId ?? 'null'} sameAsCommand=${sameAsCommand}`)

      // ── R58.6.7: OBS CaretExpectation verify ──
      const expectation = this.activeCaretExpectation
      if (expectation?.active) {
        const currentEpoch = this.userIntentEpoch
        const root = this.adapter.getEditorRoot()
        // R58.7: Scope guard — SCOPE_CHANGED BEFORE intentEpoch
        if (expectation.scopeId !== this.documentContext.scopeId) {
          console.info(
            `[InkChapter] CARET-EXPECTATION-CLOSE: ` +
            `expectationId=${expectation.expectationId} ` +
            `reason=SCOPE_CHANGED ` +
            `expectationScopeId=${expectation.scopeId} ` +
            `currentScopeId=${this.documentContext.scopeId ?? 'null'} ` +
            `restoreAttempted=false`,
          )
          expectation.active = false
          this.activeCaretExpectation = null
        } else if (expectation.intentEpoch !== currentEpoch) {
          // Superseded by newer user intent — close, never restore
          console.info(
            `[InkChapter] CARET-EXPECTATION-CLOSE: ` +
            `expectationId=${expectation.expectationId} ` +
            `reason=SUPERSEDED_BY_USER_INTENT ` +
            `expectationEpoch=${expectation.intentEpoch} ` +
            `currentEpoch=${currentEpoch} ` +
            `restoreAttempted=false`,
          )
          expectation.active = false
          this.activeCaretExpectation = null
        } else if (root) {
          const v = verifyCaretExpectation(expectation, root, (el: object) => this.getParagraphRuntimeId(el as HTMLElement), 'OBS')
          if (!v.verified && expectation.restoreAttempts < 1 && this.userIntentEpoch === expectation.intentEpoch) {
            // R58.7: content snapshot insurance — never overwrite legitimate user offset drift
            const contentChanged = expectation.expectedTextContent !== undefined &&
              getUserVisibleParagraphText(expectation.expectedElement) !== expectation.expectedTextContent
            console.info(
              `[InkChapter] CARET-RESTORE-GATE: ` +
              `expectationId=${expectation.expectationId} ` +
              `contentChanged=${contentChanged} ` +
              `restoreAllowed=${!contentChanged} ` +
              `selectionWriteAttempted=${contentChanged ? 'false' : 'pending'}`,
            )
            if (contentChanged) {
              console.info(
                `[InkChapter] CARET-RESTORE-BLOCK: ` +
                `expectationId=${expectation.expectationId} ` +
                `reason=CONTENT_CHANGED_AFTER_EXPECTATION ` +
                `decision=BLOCK`,
              )
              expectation.active = false
              this.activeCaretExpectation = null
            } else {
              const restoreBefore = resolveSelectionTruth(root, (el: object) => this.getParagraphRuntimeId(el as HTMLElement), 'CARET-RESTORE-BEFORE')
              const restoreResult = restoreLogicalCaret(expectation, root, (el: object) => this.getParagraphRuntimeId(el as HTMLElement))
              this.recordPluginSelectionWrite(
                `restore-${expectation.expectationId}-${Date.now()}`,
                'CARET-CONTINUITY-RESTORE',
                expectation.reason,
                expectation.expectedRuntimeId,
                restoreBefore.logicalOffset ?? null,
                expectation.expectedLogicalOffset,
                restoreResult.success,
              )
            }
          }
        }
      }
    }

    // T4 = 150ms (observation starts here, already 0ms into observation)
    snapObs('T4_150ms')

    // T5 = 300ms (150ms into observation)
    setTimeout(() => { snapObs('T5_300ms') }, 150)

    // T6 = 500ms (350ms into observation)
    setTimeout(() => { snapObs('T6_500ms') }, 350)

    // T7 = 1000ms (850ms into observation)
    setTimeout(() => { snapObs('T7_1000ms') }, 850)

    // T8 = 1500ms (1350ms into observation)
    setTimeout(() => { snapObs('T8_1500ms') }, 1350)

    // T9 = 2000ms → close observation, close stale handoff if still active
    setTimeout(() => {
      snapObs('T9_2000ms')
      this.flushEnterRaceTrace(obs.traceData)
      // Disconnect diagnostic MutationObserver
      if (obs.mutationObserver) {
        obs.mutationObserver.disconnect()
      }
      // ── R58.6.1: Close stale handoff if original still connected ──
      const handoff = this.activeOneShotHandoff
      if (handoff && !handoff.consumed && handoff.sourceTxnId === obs.txnId) {
        const originalConnected = handoff.preElement.isConnected
        if (originalConnected || !handoff.replacementResolved) {
          console.info(
            `[InkChapter] HANDOFF-CLOSE: ` +
            `handoffId=${handoff.handoffId} ` +
            `scopeId=${handoff.scopeId} ` +
            `txnId=${obs.txnId} ` +
            `reason=NO_REPLACEMENT_REQUIRED ` +
            `originalConnected=${originalConnected} ` +
            `ageMs=${Math.round(performance.now() - obs.transactionClosedAt)} ` +
            `decision=CLOSE`,
          )
          this.activeOneShotHandoff = null
        }
      }
      this.observations.delete(obs.observationId)
      logger.info(`${obs.observationId} OBSERVATION CLOSED at T9_2000ms`)
    }, 1850)
  }

  /**
   * Install a read-only diagnostic MutationObserver on the commit-time paragraph.
   * Listens for class, style, data-inkchapter-indent-mode, childList, characterData.
   * NEVER modifies DOM, semantic, class, style, sidecar, or caret.
   */
  private installDiagnosticMutationObserver(txn: EnterIndentTransaction): void {
    const para = txn.paragraph
    try {
      const observer = new MutationObserver((mutations) => {
        if (txn.state === 'closed' && this.observations.size === 0) return
        // Find the observation for this paragraph
        let obs: PostCommitObservationSession | null = null
        for (const o of this.observations.values()) {
          if (o.paragraphAtCommit === para || o.txnId === txn.id) {
            obs = o
            break
          }
        }
        if (!obs) return

        for (const m of mutations) {
          const record: Record<string, unknown> = {
            observationId: obs.observationId,
            txnId: obs.txnId,
            relativeMs: Math.round(performance.now() - obs.transactionClosedAt),

            mutationType: m.type,
            attributeName: m.attributeName ?? null,
            oldValue: m.oldValue ?? null,

            paragraphIdentityAtCommit: obs.paragraphIdentityAtCommit,
            currentParagraphIdentity: getElementIdentity(para),
            sameDOMElement: para.isConnected && para === obs.paragraphAtCommit,

            semantic: getParagraphIndentMode(para),
            effectiveClass_indent2: para.classList.contains('inkchapter-paragraph-effective-indent-2'),
            effectiveClass_flush: para.classList.contains('inkchapter-paragraph-effective-flush'),
            computedTextIndent: window.getComputedStyle(para).textIndent,

            textContent: para.textContent?.slice(0, 80) ?? '',
            userVisibleText: getUserVisibleParagraphText(para),

            transactionActive: this.activeEnterTransaction !== null,

            lastHighLevelWriterId: (() => {
              const h = getParagraphWriterHistory(para)
              return h.length > 0 ? h[h.length - 1].writerId : null
            })(),
            lastHighLevelWriterReason: (() => {
              const h = getParagraphWriterHistory(para)
              return h.length > 0 ? h[h.length - 1].reason : null
            })(),

            selectionParagraphIdentity: window.getSelection()?.rangeCount
              ? (para.contains(window.getSelection()!.getRangeAt(0).startContainer) ? obs.paragraphIdentityAtCommit : 'different')
              : null,
          }

          // Record new values
          if (m.type === 'attributes' && m.attributeName) {
            record['newValue'] = para.getAttribute(m.attributeName)
          }
          if (m.type === 'characterData') {
            record['newValue'] = m.target.textContent?.slice(0, 80) ?? ''
          }
          if (m.type === 'childList') {
            record['addedCount'] = m.addedNodes.length
            record['removedCount'] = m.removedNodes.length
          }

          obs.traceData[`MUT-${m.type}-${m.attributeName ?? 'data'}-${Math.round(performance.now())}`] = record
        }
      })

      observer.observe(para, {
        attributes: true,
        attributeFilter: ['class', 'style', 'data-inkchapter-indent-mode'],
        attributeOldValue: true,
        childList: true,
        characterData: true,
        characterDataOldValue: true,
        subtree: true,
      })

      // Store on observation session for cleanup
      // Find the observation for this transaction
      for (const o of this.observations.values()) {
        if (o.txnId === txn.id) {
          o.mutationObserver = observer
          break
        }
      }
      if (![...this.observations.values()].some(o => o.txnId === txn.id)) {
        // Observation hasn't started yet — attach to transaction for now
        ;(txn as any)._diagnosticObserver = observer
      }
    } catch {
      // fail-open — diagnostic observer must never break runtime
    }
  }

  /** Generate a stable identity key for a paragraph element. Read-only. */
  // ── P0-5: One-Shot Paragraph Replacement Handoff ──────────────────
  // Replaces old PendingLogicalParagraphState (removed r54).
  // Only resolves replacement ONCE, transfers semantic+visual, never caret/sidecar.
  // Consumed immediately after first resolution.

  /**
   * Check active one-shot handoff: if the original paragraph is disconnected,
   * find its replacement, transfer semantic+visual once, and verify.
   * Consumed only after verified or in explicit terminal failure.
   */
  private tryExecuteOneShotHandoff(allParagraphs: HTMLElement[]): void {
    const handoff = this.activeOneShotHandoff
    if (!handoff || handoff.consumed) return

    // R58.7: Scope guard — SCOPE_CHANGED before resolve
    if (handoff.scopeId !== this.documentContext.scopeId) {
      console.info(
        `[InkChapter] HANDOFF-CLOSE: ` +
        `handoffId=${handoff.handoffId} ` +
        `scopeId=${handoff.scopeId} ` +
        `reason=SCOPE_CHANGED ` +
        `decision=CLOSE`,
      )
      this.activeOneShotHandoff = null
      return
    }

    const original = handoff.preElement
    if (original.isConnected) return // still alive

    // ── P0-C: HANDOFF-RESOLVE ──────────────────────────────────────
    const paraOrdinal = handoff.preOrdinal
    const candidateCount = paraOrdinal >= 0 && paraOrdinal < allParagraphs.length ? 1 : 0
    const candidates = candidateCount > 0 ? [allParagraphs[paraOrdinal]] : []

    const resolveTrace: Record<string, unknown> = {
      handoffId: handoff.handoffId,
      txnId: handoff.sourceTxnId,
      originalConnected: false,
      candidateCount,
      candidateIdentities: candidates.map(p => getElementIdentity(p)),
      candidateOrdinals: candidates.map(_ => paraOrdinal),
      ambiguous: candidateCount > 1,
    }

    if (candidateCount !== 1) {
      handoff.consumed = true
      // handoff failed — no candidate or ambiguous
      ;(resolveTrace as any).replacementChosen = false
      logger.info(`HANDOFF-RESOLVE: ${JSON.stringify(resolveTrace)}`)
      return
    }

    const replacement = candidates[0]
    handoff.replacementElement = replacement
    handoff.replacementOrdinal = paraOrdinal
    handoff.replacementIdentity = getElementIdentity(replacement)
    handoff.replacementResolved = true

    ;(resolveTrace as any).replacementChosen = true
    ;(resolveTrace as any).replacementIdentity = handoff.replacementIdentity
    ;(resolveTrace as any).replacementOrdinal = paraOrdinal
    ;(resolveTrace as any).matchEvidence = 'same-ordinal'
    logger.info(`HANDOFF-RESOLVE: ${JSON.stringify(resolveTrace)}`)

    // ── P0-D: HANDOFF-TRANSFER — read CURRENT semantic, not frozen ──
    const semanticBefore = getParagraphIndentMode(replacement)
    const indentBefore = window.getComputedStyle(replacement).textIndent

    // r57: Use handoff.semantic (may have been updated by Backspace), NOT creation snapshot
    const currentSemantic = handoff.semantic
    const creationSemantic = handoff.semanticAtCreation
    const semanticChanged = currentSemantic !== creationSemantic

    // HANDOFF-CURRENT-SEMANTIC trace
    const handoffSemanticTrace: Record<string, unknown> = {
      handoffId: handoff.handoffId,
      txnId: handoff.sourceTxnId,
      generation: 1, // r57: generation tracking
      preRuntimeId: handoff.preRuntimeId,
      semanticAtHandoffCreation: creationSemantic,
      semanticAtReplacementTime: currentSemantic,
      semanticChanged,
      replacementRuntimeId: this.getParagraphRuntimeId(replacement),
    }
    logger.info(`HANDOFF-CURRENT-SEMANTIC: ${JSON.stringify(handoffSemanticTrace)}`)

    const settings = this.getParagraphLayoutSettings()
    setParagraphIndentMode(replacement, currentSemantic, 'W-ONESHOT-SEMANTIC')
    const effective = resolveEffectiveParagraphIndent(currentSemantic, settings.defaultIndent)
    applyEffectiveParagraphIndent(replacement, effective, 'W-ONESHOT-VISUAL')
    handoff.semanticTransferred = true
    handoff.visualTransferred = true

    const semanticAfter = getParagraphIndentMode(replacement)
    const indentAfter = window.getComputedStyle(replacement).textIndent
    const replacementConnected = replacement.isConnected

    // r57: Verify based on current semantic (FORCE_FLUSH expects 0px, FORCE_INDENT expects 32px)
    const expectedIndent = currentSemantic === 'force-flush' ? '0px' : '32px'
    const verified = replacementConnected &&
      semanticAfter === currentSemantic &&
      indentAfter === expectedIndent

    const transferTrace: Record<string, unknown> = {
      handoffId: handoff.handoffId,
      txnId: handoff.sourceTxnId,
      semanticBefore,
      indentBefore,
      semanticWriteAttempted: true,
      visualWriteAttempted: true,
      semanticAfter,
      indentAfter,
      replacementConnected,
      verified,
    }
    logger.info(`HANDOFF-TRANSFER: ${JSON.stringify(transferTrace)}`)

    // Consume only on verified or terminal failure
    handoff.consumed = verified

    if (verified) {
      logger.info(`ONE-SHOT-HANDOFF VERIFIED: ${handoff.handoffId} semantic=${handoff.semantic}`)

      // ── R58.2: CANONICAL-BINDING-TRANSFER via registry ──
      const recordId = handoff.canonicalRecordId
      if (recordId) {
        const oldRuntimeId = this.getParagraphRuntimeId(original)
        const newRuntimeId = this.getParagraphRuntimeId(replacement)
        const docKey = this.getDocumentKey() ?? ''

        this.canonicalTransferBinding(
          recordId, original, oldRuntimeId,
          replacement, newRuntimeId,
          'HANDOFF_REPLACE',
          handoff.handoffId,
          handoff.scopeId,
        )
      } else {
        // Legacy fallback: no canonicalRecordId in handoff → use old approach
        const oldBinding = this.resolveLiveBindingByElement(original)
        if (oldBinding) {
          const oldRuntimeId = this.getParagraphRuntimeId(original)
          const newRuntimeId = this.getParagraphRuntimeId(replacement)
          const docKey = this.getDocumentKey() ?? ''

          this.upsertLiveBinding(oldBinding.recordId, handoff.sourceTxnId, replacement, oldBinding.temporary, docKey)
          this.elementToBindingRecordId.delete(original)

          console.info(
            `[InkChapter] CANONICAL-BINDING-TRANSFER-LEGACY: documentKey=${docKey} ` +
            `canonicalRecordId=${oldBinding.recordId} ` +
            `fromRuntimeId=${oldRuntimeId} toRuntimeId=${newRuntimeId} ` +
            `reason=HANDOFF_REPLACE`,
          )
        }
      }
    } else {
      logger.info(`ONE-SHOT-HANDOFF FAILED: ${handoff.handoffId} semantic=${semanticAfter} indent=${indentAfter} connected=${replacementConnected}`)
    }
  }

  /** Release active one-shot handoff (document switch, explicit override). */
  private releaseOneShotHandoff(reason: string): void {
    const handoff = this.activeOneShotHandoff
    if (!handoff) return
    logger.info(`ONE-SHOT-HANDOFF RELEASED: ${handoff.handoffId} reason=${reason}`)
    this.activeOneShotHandoff = null
  }

  /**
   * SINGLE-DOT-TRACE: automatically record state when user types "." or "。".
   *
   * Verifies that single-dot input never creates FORCE_INDENT semantic or
   * modifies sidecar. If violation detected → HARD STOP.
   */
  private traceSingleDotIfMatch(paragraph: HTMLElement | null, settings: import('./heading-types').ParagraphLayoutSettings): void {
    if (!paragraph) return
    const visibleText = getUserVisibleParagraphText(paragraph)
    // Only trace exact single dot "。" or "."
    if (visibleText !== '。' && visibleText !== '.') return

    const docKey = this.getDocumentKey()
    const semanticBefore = getParagraphIndentMode(paragraph)
    const computedBefore = window.getComputedStyle(paragraph).textIndent
    const overrides = this.inMemoryOverrides.get(docKey ?? '') ?? []
    const sidecarCountBefore = overrides.length

    const rehydrateDecision = this.getLastRehydrateDecision()

    const trace: Record<string, unknown> = {
      type: 'SINGLE-DOT-TRACE',
      timestamp: Date.now(),
      documentKey: docKey ?? 'unknown',
      paragraphIdentity: getElementIdentity(paragraph),
      visibleText,
      semanticBefore,
      semanticAfter: semanticBefore,
      computedIndentBefore: computedBefore,
      computedIndentAfter: computedBefore,
      effectiveClassBefore: paragraph.className ? String(paragraph.className).slice(0, 120) : null,
      effectiveClassAfter: paragraph.className ? String(paragraph.className).slice(0, 120) : null,
      sidecarRecordCountBefore: sidecarCountBefore,
      sidecarRecordCountAfter: sidecarCountBefore,
      lastSemanticWriter: (() => {
        const h = getParagraphWriterHistory(paragraph)
        const lastSemantic = [...h].reverse().find(w => w.writerId.includes('SEMANTIC'))
        return lastSemantic?.writerId ?? null
      })(),
      lastVisualWriter: (() => {
        const h = getParagraphWriterHistory(paragraph)
        const lastVisual = [...h].reverse().find(w =>
          w.writerId.includes('VISUAL') || w.writerId.includes('PROJECTION') || w.writerId.includes('REFRESH')
        )
        return lastVisual?.writerId ?? null
      })(),
      writerHistoryTail: (() => {
        const h = getParagraphWriterHistory(paragraph)
        return h.slice(-5).map(w => ({ id: w.writerId, reason: w.reason, relMs: w.relativeMs }))
      })(),
      rehydrateDecisionId: rehydrateDecision?.rehydrateAttemptId ?? null,
      selectedRecordId: rehydrateDecision?.selectedRecordId ?? null,
      matchStrategy: rehydrateDecision?.matchStrategy ?? null,
      candidateCount: rehydrateDecision?.candidateCount ?? 0,
      ambiguity: rehydrateDecision?.ambiguityDetected ?? false,
      blocked: rehydrateDecision?.rehydrateBlocked ?? false,
    }

    logger.info(`SINGLE-DOT-TRACE: text="${visibleText}" semantic=${semanticBefore} computed=${computedBefore} sidecar=${sidecarCountBefore} scopeId=${this.documentContext.scopeId ?? 'unknown'}`)

    // Record to observation
    const obs = this.activeEnterTransaction ? [...this.observations.values()].find(o => o.txnId === this.activeEnterTransaction?.id) : null
    if (obs) {
      obs.traceData[`SINGLE-DOT-${Date.now()}`] = trace
    }

    // ── R58.7 Phase A.1.3.1: Distinguish CURRENT_LIVE single-dot from historical wrong apply ──
    if (semanticBefore !== 'auto') {
      // Check if this is a CURRENT_LIVE record (user typed special command, not historical apply)
      const exactRecord = this.canonicalRegistry.resolveExactLiveRecord(paragraph)
      const isCurrentLive =
        exactRecord?.meta.state === 'CURRENT_LIVE' &&
        (trace.rehydrateDecisionId === null || !rehydrateDecision?.rehydrateBlocked) &&
        (trace.lastSemanticWriter as string ?? '').includes('SEMANTIC')

      if (isCurrentLive) {
        console.info(
          `[InkChapter] SINGLE-DOT-CURRENT-LIVE: ` +
          `text="${visibleText}" ` +
          `semantic=${semanticBefore} ` +
          `recordState=CURRENT_LIVE ` +
          `recordId=${exactRecord.recordId} ` +
          `scopeId=${this.documentContext.scopeId ?? 'unknown'} ` +
          `writer=${trace.lastSemanticWriter ?? 'unknown'} ` +
          `decision=INFO`,
        )
      } else {
        logger.error(`SINGLE-DOT-WRONG-APPLY: text="${visibleText}" semantic=${semanticBefore} — HARD STOP`)
        logger.error('WRONG APPLY DETAILS:', JSON.stringify(trace, null, 2))
      }
    }
  }

  private lastRehydrateDecisionSnapshot: RehydrateMatchProvenance | null = null

  private getLastRehydrateDecision(): RehydrateMatchProvenance | null {
    return this.lastRehydrateDecisionSnapshot
  }

  /**
   * Immediate local projection for the current paragraph.
   *
   * Computes effective visual indent (semantic → structural → effective) and
   * applies it synchronously, BEFORE the next RAF refresh.
   * Only touches the current paragraph — no full document scan.
   *
   * NO shortcut candidate logic — token text is ordinary text until Enter submit.
   */
  private projectCurrentParagraphLocally(root: HTMLElement): void {
    const block = resolveCurrentBlockFromSelection(root)
    if (!block || block.tagName !== 'P') return
    if (!isContentBlock(block)) return
    if (isInExcludedContext(block)) return

    // ── Active transaction guard: never overwrite FORCE_INDENT ──
    const txn = this.activeEnterTransaction
    if (txn && txn.paragraph === block && txn.state === 'committed') {
      return // transaction owns this paragraph — keep its FORCE_INDENT
    }

    const settings = this.getParagraphLayoutSettings()

    const semantic = getParagraphIndentMode(block)

    const structuralContext = {
      isFormulaContinuation: settings.flushAfterDisplayMath
        ? isAfterDisplayMath(block)
        : false,
    }

    // Transient editing visual: suppress if paragraph belongs to active transaction
    let isEditingToken = false
    if (!txn || txn.paragraph !== block) {
      isEditingToken = isIndentShortcutEditingToken(block, settings.indentShortcutEnabled)
    }

    const effective = resolveEffectiveParagraphIndent(
      semantic,
      settings.defaultIndent,
      structuralContext,
      { isShortcutEditingToken: isEditingToken },
    )

    applyEffectiveParagraphIndent(block, effective, WriterIds.LOCAL_PROJECTION_VISUAL)
  }

  /**
   * Clear the command token from a paragraph by modifying only the text node.
   *
   * Must preserve Typora's inline DOM structure (<span>, etc.).
   * Does NOT use execCommand (unreliable in Typora).
   * Does NOT use textContent= replacement (destroys inline spans).
   *
   * Instead: finds the exact text node containing the token and
   * replaces the token substring within that text node only.
   */
  private clearParagraphToken(paragraph: HTMLElement, token: '..' | '。。'): void {
    // Find the text node containing the token
    const textNode = findTextNodeContaining(paragraph, token)
    if (!textNode) return

    const content = textNode.textContent ?? ''
    const idx = content.indexOf(token)
    if (idx < 0) return

    // Replace token within the text node — preserves all DOM structure
    textNode.textContent = content.slice(0, idx) + content.slice(idx + token.length)
  }

  /** Place caret at the start of a paragraph, handling empty/BR/text node. */
  private placeCaretInParagraph(paragraph: HTMLElement): CaretWriteResult {
    const result: CaretWriteResult = {
      success: false,
      caretWritten: false,
      targetConnected: false,
      realmSafe: false,
      method: 'none',
      resolvedParagraphIdentity: null,
    }

    // ── P0-4: structured validation ──
    if (!paragraph) {
      result.failReason = 'null-target'
      return result
    }

    // ── P0-3: Realm-safe Node validation ──
    // Use ownerDocument to avoid cross-realm instanceof failures
    const ownerDoc = paragraph.ownerDocument
    if (!ownerDoc) {
      result.failReason = 'no-ownerDocument'
      logger.info('CARET_TARGET_INVALID: no ownerDocument (cross-realm?)')
      return result
    }

    // Validate against owner document's Node constructor
    try {
      if (!(paragraph instanceof ownerDoc.defaultView!.Node)) {
        result.failReason = 'not-a-node-in-realm'
        logger.info('CARET_TARGET_INVALID: paragraph is not a Node in owner document realm')
        return result
      }
    } catch {
      result.failReason = 'instanceof-check-failed'
      logger.info('CARET_TARGET_INVALID: instanceof check threw (cross-realm)')
      return result
    }

    result.realmSafe = true

    if (!paragraph.isConnected) {
      result.failReason = 'disconnected'
      logger.info('CARET_TARGET_INVALID: paragraph not connected')
      return result
    }
    result.targetConnected = true

    // ── P0-3: Use ownerDocument.createRange() ──
    try {
      const sel = ownerDoc.defaultView?.getSelection()
      if (!sel) {
        result.failReason = 'no-selection'
        return result
      }

      const range = ownerDoc.createRange()

      // Find first text node or BR
      const firstChild = paragraph.firstChild
      if (firstChild?.nodeType === ownerDoc.defaultView!.Node.TEXT_NODE) {
        range.setStart(firstChild, 0)
      } else if (firstChild?.nodeName === 'BR') {
        range.setStartBefore(firstChild)
      } else {
        range.setStart(paragraph, 0)
      }
      range.collapse(true)
      sel.removeAllRanges()
      sel.addRange(range)

      result.caretWritten = true
      result.success = true
      result.method = 'owner-realm-range'
      result.resolvedParagraphIdentity = getElementIdentity(paragraph)
      this.recordPluginSelectionWrite(
        `write-${Date.now()}`,
        'CARET-REPAIR',
        'placeCaretInParagraph',
        getElementIdentity(paragraph),
        null,
        0,
        result.success,
      )
    } catch (e) {
      result.failReason = `range-error: ${e}`
      logger.info('CARET_WRITE_FAILED:', e)
    }

    return result
  }

  // ── r56: Paragraph-Local Caret Writer ────────────────────────────
  // No instanceof guards. Uses nodeType, ownerDocument, isConnected,
  // and DOM capability checks only. Range from paragraph.ownerDocument.

  private placeCaretAtParagraphLogicalStart(
    paragraph: HTMLElement,
    commandIdentity: string,
  ): ParagraphLocalCaretWriteResult {
    const result: ParagraphLocalCaretWriteResult = {
      attempted: true,
      success: false,
      writerType: 'paragraph-local-range',
      targetParagraphIdentity: commandIdentity,
      targetParagraphOrdinal: -1,
      targetConnected: false,
      sameAsCommandParagraph: false,
    }

    // Realm-safe structural validation — NO instanceof
    if (!paragraph || paragraph.nodeType !== 1) {
      result.failureReason = 'null-or-not-element'
      return result
    }
    const ownerDoc = paragraph.ownerDocument
    if (!ownerDoc) {
      result.failureReason = 'no-ownerDocument'
      return result
    }
    if (!paragraph.isConnected) {
      result.failureReason = 'disconnected'
      return result
    }
    result.targetConnected = true

    // Get ordinal for reference
    const root = this.adapter.getEditorRoot()
    if (root) {
      const allParas = collectContentParagraphs(root)
      result.targetParagraphOrdinal = allParas.indexOf(paragraph)
    }

    // EMPTY-PARAGRAPH-DOM-PROBE (diagnostic)
    this.probeEmptyParagraphDOM(paragraph)

    // Use ownerDocument.createRange() — never global document
    try {
      const doc = ownerDoc
      const win = doc.defaultView
      if (!win) { result.failureReason = 'no-defaultView'; return result }

      const sel = win.getSelection()
      if (!sel) { result.failureReason = 'no-selection'; return result }

      const range = doc.createRange()
      // selectNodeContents + collapse(true) = caret at paragraph local logical start
      range.selectNodeContents(paragraph)
      range.collapse(true)
      sel.removeAllRanges()
      sel.addRange(range)

      // Resolve actual selection paragraph for verification
      const anchorNode = sel.anchorNode
      result.selectionContainerType = anchorNode?.nodeType === Node.TEXT_NODE ? 'text' : anchorNode?.nodeName ?? 'unknown'
      result.selectionOffset = sel.anchorOffset

      // Walk up to find the P ancestor
      let resolved: HTMLElement | null = null
      if (anchorNode) {
        if (anchorNode.nodeType === Node.ELEMENT_NODE && (anchorNode as Element).tagName === 'P') {
          resolved = anchorNode as HTMLElement
        } else {
          const el = (anchorNode.nodeType === Node.ELEMENT_NODE ? anchorNode : anchorNode.parentElement) as Element | null
          resolved = el?.closest('p') as HTMLElement | null
        }
      }
      if (resolved) {
        result.resolvedSelectionParagraphIdentity = getElementIdentity(resolved)
        if (root) {
          const allParas = collectContentParagraphs(root)
          result.resolvedSelectionParagraphOrdinal = allParas.indexOf(resolved)
        }
        result.localLogicalOffset = result.selectionOffset ?? 0
        result.sameAsCommandParagraph = result.resolvedSelectionParagraphIdentity === commandIdentity
      }

      result.success = result.sameAsCommandParagraph && (result.localLogicalOffset ?? -1) === 0
      this.recordPluginSelectionWrite(
        `write-${Date.now()}`,
        'CARET-REPAIR',
        'placeCaretAtParagraphLogicalStart',
        commandIdentity,
        null,
        0,
        result.success,
      )
    } catch (e) {
      result.failureReason = `range-error: ${e}`
    }

    // ENTER-CARET-LOCAL trace
    logger.info(`ENTER-CARET-LOCAL: commandIdentity=${commandIdentity} targetOrdinal=${result.targetParagraphOrdinal} writer=${result.writerType} connected=${result.targetConnected} success=${result.success} sameParagraph=${result.sameAsCommandParagraph} localOffset=${result.localLogicalOffset} selectionIdentity=${result.resolvedSelectionParagraphIdentity ?? 'null'} failureReason=${result.failureReason ?? 'none'}`)

    return result
  }

  /** EMPTY-PARAGRAPH-DOM-PROBE: diagnostic only, never mutates. */
  private probeEmptyParagraphDOM(paragraph: HTMLElement): void {
    try {
      const children: Array<{ idx: number; nodeType: number; nodeName: string; text: string }> = []
      for (let i = 0; i < paragraph.childNodes.length; i++) {
        const c = paragraph.childNodes[i]
        children.push({ idx: i, nodeType: c.nodeType, nodeName: c.nodeName, text: c.textContent?.slice(0, 30) ?? '' })
      }
      const sel = paragraph.ownerDocument?.defaultView?.getSelection()
      logger.info(`EMPTY-PARAGRAPH-DOM-PROBE: tagName=${paragraph.tagName} className=${paragraph.className?.slice(0,40) ?? ''} nodeType=${paragraph.nodeType} isConnected=${paragraph.isConnected} textContent=${paragraph.textContent?.slice(0,20) ?? ''} childCount=${paragraph.childNodes.length} children=${JSON.stringify(children)} firstChildType=${paragraph.firstChild?.nodeType ?? 'none'} ownerDoc=${!!paragraph.ownerDocument} defaultView=${!!paragraph.ownerDocument?.defaultView} selAnchorNode=${sel?.anchorNode?.nodeName ?? 'none'} selAnchorOffset=${sel?.anchorOffset ?? -1}`)
    } catch { /* fail-open */ }
  }

  /**
   * Unified entry point: apply paragraph indent override.
   * Handles both runtime semantic state and sidecar persistence.
   * Used by both shortcut and manual command.
   */
  applyParagraphIndentOverride(
    paragraph: HTMLElement,
    mode: 'force-indent' | 'force-flush' | 'auto',
    writerId?: string,
  ): void {
    setParagraphIndentMode(paragraph, mode, writerId)
    const root = this.adapter.detectEditorRoot()
    if (root) {
      refreshParagraphIndentStyles(root, this.getParagraphLayoutSettings())
    }
    // R58.2: Use intent-specific API
    const docKey = this.getDocumentKey()
    const docPath = this.ctx.getActiveFilePath?.() ?? 'unknown'
    if (docKey) {
      this.canonicalUpdateUI(
        paragraph, mode,
        this.getParagraphRuntimeId(paragraph),
        docKey, docPath,
      )
    }
  }

  private applyParagraphIndentOverrideToSidecar(
    paragraph: HTMLElement,
    _mode: 'force-indent' | 'force-flush' | 'auto',
  ): void {
    this.applyParagraphIndentOverrideToSidecarR58(paragraph, _mode, '', 'LEGACY')
  }

  /**
   * R58: Canonical sidecar upsert with live binding lookup.
   * Returns decision metadata for trace logging.
   */
  private applyParagraphIndentOverrideToSidecarR58(
    paragraph: HTMLElement,
    _mode: 'force-indent' | 'force-flush' | 'auto',
    txnId: string,
    operationReason: string,
  ): { recordId: string; decision: 'UPDATE_EXISTING' | 'CREATE_NEW' | 'BLOCK' } {
    const docKey = this.getDocumentKey()
    const docPath = this.ctx.getActiveFilePath?.() ?? 'unknown'
    const result = { recordId: '', decision: 'BLOCK' as 'UPDATE_EXISTING' | 'CREATE_NEW' | 'BLOCK' }
    if (!docKey) return result
    const root = this.adapter.getEditorRoot()
    if (!root) return result
    const allParas = collectContentParagraphs(root)
    const paraIndex = allParas.indexOf(paragraph)
    if (paraIndex < 0) return result
    const anchor = createParagraphAnchor(paraIndex, allParas)
    const isTemporary = !paragraph.textContent?.trim()
    const overrides = this.inMemoryOverrides.get(docKey) ?? []
    const runtimeId = this.getParagraphRuntimeId(paragraph)
    const recordCountBefore = overrides.length

    // ── R58: Live binding lookup FIRST ────────────────────────────────
    const liveBinding = this.resolveLiveBindingByElement(paragraph)
    let existing = overrides.find(o => o.id === liveBinding?.recordId)

    // Anchor-based fallback (only used when no live binding)
    let anchorExisting: ParagraphIndentOverrideRecord | undefined
    if (!existing) {
      anchorExisting = overrides.find(o => resolveParagraphAnchor(o.anchor, allParas)?.index === paraIndex)
    }

    // SIDECAR-UPSERT-DECISION trace fields
    const upsertTrace: Record<string, unknown> = {
      operationReason,
      txnId,
      incomingRuntimeId: runtimeId,
      incomingParagraphOrdinal: paraIndex,
      incomingMode: _mode,
      incomingTemporary: isTemporary,
      recordIdFromElementBinding: liveBinding?.recordId ?? null,
      recordIdFromLiveBinding: liveBinding?.recordId ?? null,
      recordIdFromAnchor: anchorExisting?.id ?? null,
      recordIdFromOrdinal: null,
      recordCountBefore,
    }

    // ── AUTO mode: remove existing record ─────────────────────────────
    if (_mode === 'auto') {
      if (existing) {
        const clean = overrides.filter(o => o !== existing)
        this.inMemoryOverrides.set(docKey, clean)
        this.scheduleSidecarWrite(docKey, docPath, clean)
        result.recordId = existing.id
        result.decision = 'UPDATE_EXISTING'
      }
      upsertTrace['decision'] = result.decision
      upsertTrace['selectedRecordId'] = existing?.id ?? null
      logger.info(`SIDECAR-UPSERT-DECISION: ${JSON.stringify(upsertTrace)}`)
      return result
    }

    // ── UPDATE or CREATE (with BACKSPACE BLOCK invariant) ─────────────
    if (existing) {
      existing.mode = _mode
      existing.anchor = anchor
      existing.temporary = isTemporary
      result.recordId = existing.id
      result.decision = 'UPDATE_EXISTING'
    } else if (anchorExisting) {
      anchorExisting.mode = _mode
      anchorExisting.anchor = anchor
      anchorExisting.temporary = isTemporary
      result.recordId = anchorExisting.id
      result.decision = 'UPDATE_EXISTING'
    } else if (operationReason === 'BACKSPACE_UPDATE') {
      // R58 Phase F: BACKSPACE_UPDATE MUST NOT CREATE_NEW — BLOCK
      result.recordId = ''
      result.decision = 'BLOCK'
      upsertTrace['backspaceBlocked'] = true
      upsertTrace['blockReason'] = 'no trusted identity for Backspace — element/live/anchor all null'
      logger.info(`BACKSPACE-CANONICAL-BLOCK: runtimeId=${runtimeId} reason=NO_TRUSTED_IDENTITY`)
      // Do NOT push a new record. Do NOT write sidecar.
      upsertTrace['decision'] = 'BLOCK'
      upsertTrace['selectedRecordId'] = null
      upsertTrace['recordCountAfter'] = overrides.length
      logger.info(`SIDECAR-UPSERT-DECISION: ${JSON.stringify(upsertTrace)}`)
      return result
    } else {
      const newId = `indent-${Date.now()}-${overrides.length}`
      overrides.push({ id: newId, mode: _mode, anchor, temporary: isTemporary })
      result.recordId = newId
      result.decision = 'CREATE_NEW'
    }

    this.inMemoryOverrides.set(docKey, [...overrides])
    this.scheduleSidecarWrite(docKey, docPath, overrides)

    upsertTrace['selectedRecordId'] = result.recordId
    upsertTrace['decision'] = result.decision
    upsertTrace['recordCountAfter'] = overrides.length

    // ── R58 Hard Stops ────────────────────────────────────────────────
    if (operationReason === 'BACKSPACE_UPDATE' && result.decision === 'CREATE_NEW') {
      upsertTrace['BACKSPACE_DUPLICATE_RECORD_BUG'] = true
      upsertTrace['whyElementBindingMissing'] = liveBinding ? 'none' : 'no element→recordId in WeakMap'
      upsertTrace['whyLiveBindingMissing'] = liveBinding ? 'none' : 'no liveBinding for element'
      upsertTrace['whyAnchorLookupRejected'] = anchorExisting ? 'none' : 'anchor resolution did not match'
      logger.info(`BACKSPACE-DUPLICATE-RECORD-BUG: ${JSON.stringify(upsertTrace)}`)
      console.info(
        `[InkChapter] BACKSPACE-RECORD-COUNT-INVARIANT-VIOLATION: ` +
        `runtimeId=${runtimeId} recordCountBefore=${recordCountBefore} recordCountAfter=${overrides.length}`,
      )
    }

    logger.info(`SIDECAR-UPSERT-DECISION: ${JSON.stringify(upsertTrace)}`)
    return result
  }

  private sidecarWriteTimer: ReturnType<typeof setTimeout> | null = null
  private sidecarWritePending: { docKey: string; docPath: string; overrides: ParagraphIndentOverrideRecord[] } | null = null
  private sidecarGeneration = 0

  private scheduleSidecarWrite(docKey: string, docPath: string, overrides: ParagraphIndentOverrideRecord[]): void {
    // ── R58.7 Phase A.1.2: Skip scheduling when persistence not ready (EPHEMERAL mode) ──
    if (!this.documentContext.persistenceReady) {
      console.info(
        `[InkChapter] SIDECAR-WRITE-SKIP: ` +
        `mode=${this.documentContext.mode} ` +
        `scopeId=${this.documentContext.scopeId ?? 'null'} ` +
        `persistenceKey=${this.documentContext.persistenceKey ?? 'null'} ` +
        `reason=PERSISTENCE_NOT_READY ` +
        `decision=SKIP`,
      )
      return
    }
    // Deep clone records + anchors for immutable snapshot.
    // Prevents 200ms debounce window mutations from corrupting the pending write.
    const snapshot = overrides.map(o => ({
      ...o,
      anchor: { ...o.anchor },
    }))
    this.sidecarWritePending = { docKey, docPath, overrides: snapshot }
    const gen = ++this.sidecarGeneration
    if (this.sidecarWriteTimer !== null) clearTimeout(this.sidecarWriteTimer)
    this.sidecarWriteTimer = setTimeout(() => {
      this.sidecarWriteTimer = null
      const pending = this.sidecarWritePending
      // Only execute if no newer generation has been scheduled
      if (pending && this.sidecarGeneration === gen) {
        this.sidecarWritePending = null
        saveParagraphLayout(pending.docKey, pending.docPath, pending.overrides)
      }
    }, 200)
  }

  /** Flush pending sidecar writes (call before document switch). */
  private flushSidecarWrite(): void {
    if (this.sidecarWriteTimer !== null) {
      clearTimeout(this.sidecarWriteTimer)
      this.sidecarWriteTimer = null
    }
    const pending = this.sidecarWritePending
    if (pending) {
      this.sidecarWritePending = null
      if (!this.assertPersistenceContextReady('flush-sidecar')) return
      saveParagraphLayout(pending.docKey, pending.docPath, pending.overrides)
    }
  }

  // ── R58.2: Intent-Specific Canonical Mutation API ──────────────────
  // Replaces the generic applyParagraphIndentOverrideToSidecarR58.
  // Each mutation intent maps to exactly one API — no ambiguous paths.

  /**
   * ENTER_CREATE_OR_REUSE: Create a canonical record for a newly-entered paragraph,
   * or reuse an existing live binding. This is the ONLY path that can CREATE_NEW.
   */
  private canonicalCreateOrReuseForEnter(
    paragraph: HTMLElement,
    mode: 'force-indent' | 'force-flush',
    txnId: string,
    runtimeId: string,
    documentKey: string,
    documentPath: string,
  ): { recordId: string; decision: 'CREATE_NEW' | 'REUSE_EXISTING' } {
    const root = this.adapter.getEditorRoot()
    const allParas = root ? collectContentParagraphs(root) : []
    const paraIndex = allParas.indexOf(paragraph)
    const anchor = paraIndex >= 0 ? createParagraphAnchor(paraIndex, allParas) : { lastKnownOrdinal: -1 }
    const isTemporary = !paragraph.textContent?.trim()
    const overrides = this.inMemoryOverrides.get(documentKey) ?? []
    const recordCountBefore = overrides.length

    // ── Check canonical registry for existing binding ──
    const exactRecord = this.canonicalRegistry.resolveExactLiveRecord(paragraph)
    if (exactRecord) {
      // Reuse existing canonical record
      const existing = overrides.find(o => o.id === exactRecord.recordId)
      if (existing) {
        existing.mode = mode
        existing.anchor = anchor
        existing.temporary = isTemporary
        this.inMemoryOverrides.set(documentKey, [...overrides])
        this.scheduleSidecarWrite(documentKey, documentPath, overrides)

        console.info(
          `[InkChapter] CANONICAL-RECORD-COMMIT: txnId=${txnId} ` +
          `recordId=${exactRecord.recordId} ` +
          `decision=REUSE_EXISTING ` +
          `recordCountBefore=${recordCountBefore} recordCountAfter=${overrides.length} ` +
          `mode=${mode} temporary=${isTemporary} ` +
          `boundRuntimeId=${runtimeId}`,
        )
        return { recordId: exactRecord.recordId, decision: 'REUSE_EXISTING' }
      }
    }

    // ── Check registry by runtimeId ──
    const byRt = this.canonicalRegistry.resolveByRuntimeId(runtimeId)
    if (byRt && byRt.meta.state === 'CURRENT_LIVE') {
      const existing = overrides.find(o => o.id === byRt.recordId)
      if (existing) {
        existing.mode = mode
        existing.anchor = anchor
        existing.temporary = isTemporary
        // Update element binding
        try {
          this.canonicalRegistry.registerCurrentSessionRecord(
            existing, documentKey, paragraph, runtimeId, isTemporary,
            this.documentContext.scopeId ?? documentKey,
            this.documentContext.persistenceKey,
          )
        } catch { /* collision already logged */ }
        this.inMemoryOverrides.set(documentKey, [...overrides])
        this.scheduleSidecarWrite(documentKey, documentPath, overrides)

        console.info(
          `[InkChapter] CANONICAL-RECORD-COMMIT: txnId=${txnId} ` +
          `recordId=${byRt.recordId} decision=REUSE_EXISTING ` +
          `recordCountBefore=${recordCountBefore} recordCountAfter=${overrides.length} ` +
          `mode=${mode} temporary=${isTemporary} boundRuntimeId=${runtimeId}`,
        )
        return { recordId: byRt.recordId, decision: 'REUSE_EXISTING' }
      }
    }

    // ── CREATE_NEW — only allowed here ──
    const newId = `indent-${Date.now()}-${overrides.length}`
    const newRecord: ParagraphIndentOverrideRecord = {
      id: newId,
      mode,
      anchor,
      temporary: isTemporary,
    }
    overrides.push(newRecord)
    this.inMemoryOverrides.set(documentKey, [...overrides])

    // Register in canonical registry
    try {
      this.canonicalRegistry.registerCurrentSessionRecord(
        newRecord, documentKey, paragraph, runtimeId, isTemporary,
        this.documentContext.scopeId ?? documentKey,
        this.documentContext.persistenceKey,
      )
    } catch (e) {
      logger.warn(`CANONICAL-REGISTRY-REGISTER-WARN: ${e}`)
    }

    this.scheduleSidecarWrite(documentKey, documentPath, overrides)

    console.info(
      `[InkChapter] CANONICAL-RECORD-COMMIT: txnId=${txnId} ` +
      `recordId=${newId} decision=CREATE_NEW ` +
      `recordCountBefore=${recordCountBefore} recordCountAfter=${overrides.length} ` +
      `mode=${mode} temporary=${isTemporary} boundRuntimeId=${runtimeId}`,
    )
    return { recordId: newId, decision: 'CREATE_NEW' }
  }

  /**
   * BACKSPACE_UPDATE_EXISTING: Update an existing record's mode.
   * MUST have exact canonical identity. BLOCK if no identity found.
   * CANNOT create new records.
   */
  private canonicalUpdateBackspace(
    paragraph: HTMLElement,
    mode: 'force-flush',
    runtimeId: string,
    documentKey: string,
    documentPath: string,
  ): { recordId: string; decision: 'UPDATE_EXISTING' | 'BLOCK'; blockReason?: string } {
    const overrides = this.inMemoryOverrides.get(documentKey) ?? []
    const recordCountBefore = overrides.length

    // ── Exact canonical owner lookup ONLY ──
    const exactRecord = this.canonicalRegistry.resolveExactLiveRecord(paragraph)
    if (!exactRecord) {
      // Try by runtimeId
      const byRt = this.canonicalRegistry.resolveByRuntimeId(runtimeId)
      if (!byRt || byRt.meta.state !== 'CURRENT_LIVE') {
        console.info(
          `[InkChapter] BACKSPACE-CANONICAL-BLOCK: runtimeId=${runtimeId} ` +
          `reason=NO_TRUSTED_IDENTITY ` +
          `recordCount=${recordCountBefore} ` +
          `ACTION=BLOCK`,
        )
        return { recordId: '', decision: 'BLOCK', blockReason: 'no trusted identity for Backspace' }
      }

      // R58.4: Mutation firewall
      const validation = this.canonicalRegistry.validateMutation(
        byRt.recordId, 'BACKSPACE_UPDATE', 'CURRENT_LIVE',
        documentKey, runtimeId, paragraph,
      )
      if (!validation.ok) {
        console.error(
          `[InkChapter] CANONICAL-MUTATION-BLOCK: ` +
          `recordId=${byRt.recordId} intent=BACKSPACE_UPDATE ` +
          `reason=${validation.reason} ACTION=BLOCK`,
        )
        return { recordId: '', decision: 'BLOCK', blockReason: `lifecycle-firewall: ${validation.reason}` }
      }

      const existing = overrides.find(o => o.id === byRt.recordId)
      if (!existing) {
        return { recordId: '', decision: 'BLOCK', blockReason: 'record not found in inMemoryOverrides' }
      }

      existing.mode = mode
      this.inMemoryOverrides.set(documentKey, [...overrides])
      this.scheduleSidecarWrite(documentKey, documentPath, overrides)

      console.info(
        `[InkChapter] CANONICAL-RECORD-BACKSPACE: runtimeId=${runtimeId} ` +
        `recordId=${byRt.recordId} ` +
        `recordCountBefore=${recordCountBefore} recordCountAfter=${overrides.length} ` +
        `modeBefore=FORCE_INDENT modeAfter=FORCE_FLUSH ` +
        `decision=UPDATE_EXISTING sameRecord=${recordCountBefore === overrides.length}`,
      )
      return { recordId: byRt.recordId, decision: 'UPDATE_EXISTING' }
    }

    // R58.4: Mutation firewall
    const validation = this.canonicalRegistry.validateMutation(
      exactRecord.recordId, 'BACKSPACE_UPDATE', 'CURRENT_LIVE',
      documentKey, runtimeId, paragraph,
    )
    if (!validation.ok) {
      console.error(
        `[InkChapter] CANONICAL-MUTATION-BLOCK: ` +
        `recordId=${exactRecord.recordId} intent=BACKSPACE_UPDATE ` +
        `reason=${validation.reason} ACTION=BLOCK`,
      )
      return { recordId: '', decision: 'BLOCK', blockReason: `lifecycle-firewall: ${validation.reason}` }
    }

    const existing = overrides.find(o => o.id === exactRecord.recordId)
    if (!existing) {
      return { recordId: '', decision: 'BLOCK', blockReason: 'record not found in inMemoryOverrides' }
    }

    existing.mode = mode
    this.inMemoryOverrides.set(documentKey, [...overrides])
    this.scheduleSidecarWrite(documentKey, documentPath, overrides)

    const recordCountAfter = overrides.length
    console.info(
      `[InkChapter] CANONICAL-RECORD-BACKSPACE: runtimeId=${runtimeId} ` +
      `recordId=${exactRecord.recordId} ` +
      `recordCountBefore=${recordCountBefore} recordCountAfter=${recordCountAfter} ` +
      `modeBefore=FORCE_INDENT modeAfter=FORCE_FLUSH ` +
      `sameRecord=${recordCountBefore === recordCountAfter} ` +
      `decision=UPDATE_EXISTING ` +
      `appendOccurred=${recordCountAfter > recordCountBefore}`,
    )
    return { recordId: exactRecord.recordId, decision: 'UPDATE_EXISTING' }
  }

  /**
   * UI_UPDATE_EXISTING: Update an existing record via explicit UI command.
   * Also handles AUTO mode (removes record).
   */
  private canonicalUpdateUI(
    paragraph: HTMLElement,
    mode: 'force-indent' | 'force-flush' | 'auto',
    runtimeId: string,
    documentKey: string,
    documentPath: string,
  ): { recordId: string; decision: 'UPDATE_EXISTING' | 'CREATE_NEW' | 'DELETE' } {
    const overrides = this.inMemoryOverrides.get(documentKey) ?? []

    if (mode === 'auto') {
      const exactRecord = this.canonicalRegistry.resolveExactLiveRecord(paragraph)
      if (exactRecord) {
        const clean = overrides.filter(o => o.id !== exactRecord.recordId)
        this.inMemoryOverrides.set(documentKey, clean)
        this.canonicalRegistry.deleteRecord(exactRecord.recordId)
        this.scheduleSidecarWrite(documentKey, documentPath, clean)
        return { recordId: exactRecord.recordId, decision: 'DELETE' }
      }
      return { recordId: '', decision: 'UPDATE_EXISTING' }
    }

    // Non-auto: find existing or create
    const exactRecord = this.canonicalRegistry.resolveExactLiveRecord(paragraph)
    if (exactRecord) {
      const existing = overrides.find(o => o.id === exactRecord.recordId)
      if (existing) {
        existing.mode = mode
        this.inMemoryOverrides.set(documentKey, [...overrides])
        this.scheduleSidecarWrite(documentKey, documentPath, overrides)
        return { recordId: exactRecord.recordId, decision: 'UPDATE_EXISTING' }
      }
    }

    // Fallback: create (UI commands are user-initiated)
    const newId = `indent-ui-${Date.now()}-${overrides.length}`
    const root = this.adapter.getEditorRoot()
    const allParas = root ? collectContentParagraphs(root) : []
    const paraIndex = allParas.indexOf(paragraph)
    const anchor = paraIndex >= 0 ? createParagraphAnchor(paraIndex, allParas) : { lastKnownOrdinal: -1 }
    overrides.push({ id: newId, mode, anchor, temporary: !paragraph.textContent?.trim() })
    this.inMemoryOverrides.set(documentKey, [...overrides])
    this.scheduleSidecarWrite(documentKey, documentPath, overrides)
    return { recordId: newId, decision: 'CREATE_NEW' }
  }

  /**
   * TRANSFER_BINDING_ONLY: Transfer canonical binding from old to new element.
   *
   * R58.7 Step 3: ATOMIC canonical projection — PROJECTION-BEFORE-IDENTITY.
   *   PREPARE → read record → semantic projection → visual projection → verify →
   *   ONLY THEN commit identity to Registry → FINAL AUDIT.
   */
  private canonicalTransferBinding(
    recordId: string,
    fromElement: HTMLElement,
    fromRuntimeId: string,
    toElement: HTMLElement,
    toRuntimeId: string,
    reason: string,
    handoffId?: string,
    scopeId?: string,
  ): CanonicalBindingTransferResult {
    // ── PREPARE: Obtain canonical record by KNOWN recordId (NOT live fromElement) ──
    // The source paragraph (fromElement) may already be disconnected after a split.
    // Business identity (recordMode) MUST come from the known recordId's canonical record,
    // never from re-resolving the disconnected element via live-only resolver.
    const record = this.canonicalRegistry.getRecord(recordId)
    const meta = this.canonicalRegistry.getRuntimeMeta(recordId)
    const stateBeforeAwait = meta?.state ?? 'CURRENT_LIVE'
    const recordMode = record?.mode ?? null

    // Immutable plan built BEFORE markAwaitingTransfer, while record is still CURRENT_LIVE.
    const transferPlan: CanonicalTransferPlan = {
      recordId,
      recordMode,
      scopeId: meta?.scopeId ?? scopeId ?? 'unknown',
      persistenceKey: meta?.persistenceKey ?? null,
      generation: meta?.generation ?? 0,
      fromRuntimeId,
      candidateRuntimeId: toRuntimeId,
    }

    emitRuntimeAudit('TRANSFER-PLAN', {
      recordId,
      recordLookupSource: 'KNOWN_RECORD_ID',
      stateBeforeAwait,
      recordMode: recordMode ?? 'none',
      generation: transferPlan.generation,
      scopeId: transferPlan.scopeId,
      fromRuntimeId,
      candidateRuntimeId: toRuntimeId,
      overall: recordMode !== null,
    })

    // ── R58.7 Step 3: Candidate resolution guard ──
    // Verify candidate is uniquely resolved (matches active NormalEnter txn's completedOriginal)
    if (this.activeNormalEnterTxn?.active && this.activeNormalEnterTxn.completedOriginalRuntimeId) {
      if (toRuntimeId !== this.activeNormalEnterTxn.completedOriginalRuntimeId) {
        console.warn(
          `[InkChapter] CANONICAL-TRANSFER-CANDIDATE-MISMATCH: ` +
          `candidateRuntimeId=${toRuntimeId} ` +
          `txnCompletedOriginal=${this.activeNormalEnterTxn.completedOriginalRuntimeId} ` +
          `decision=WARN_CONTINUE`,
        )
      }
    }

    console.info(
      `[InkChapter] CANONICAL-TRANSFER-PREPARE: ` +
      `recordId=${recordId} ` +
      `fromRuntimeId=${fromRuntimeId} ` +
      `candidateRuntimeId=${toRuntimeId} ` +
      `recordMode=${recordMode ?? 'none'} ` +
      `reason=${reason}`,
    )

    // ── PROJECT: Apply semantic + visual to candidate BEFORE identity commit ──
    let semanticTransfer = false
    let visualTransfer = false
    let newOwnerSemantic = 'unknown'
    let expectedIndent = 'unknown'
    let actualIndent = 'unknown'
    let expectedEffectiveMode = 'unknown'
    let actualEffectiveMode = 'unknown'
    let visualFontSize = 0
    let expectedComputedIndent = 0
    let actualComputedIndent = 0

    // R58.7 Step 3: Snapshot candidate pre-state for potential rollback (4 fields)
    const preCandidateSemantic = toElement.getAttribute('data-inkchapter-indent-mode') ?? 'auto'
    const preCandidateEffectiveIndentClass = (
      toElement.classList.contains('inkchapter-paragraph-effective-indent-2') ? 'indent-2'
      : toElement.classList.contains('inkchapter-paragraph-effective-flush') ? 'flush'
      : 'none'
    )
    const preCandidateInlineTextIndent = toElement.style.textIndent
    const preCandidateComputedIndent = window.getComputedStyle(toElement).textIndent

    if (recordMode) {
      // Apply semantic
      setParagraphIndentMode(toElement, recordMode, 'W-CANONICAL-TRANSFER-SEMANTIC')
      newOwnerSemantic = getParagraphIndentMode(toElement)
      semanticTransfer = (newOwnerSemantic === recordMode)

      // Apply visual projection (class-based, NEVER hardcoded px)
      const settings = this.getParagraphLayoutSettings()
      const effective = resolveEffectiveParagraphIndent(
        recordMode as 'force-indent' | 'force-flush',
        settings.defaultIndent,
        { isFormulaContinuation: false },
      )
      applyEffectiveParagraphIndent(toElement, effective, 'W-CANONICAL-TRANSFER-VISUAL')

      // ── Visual verification: two independent layers ──
      // Layer 1 — effective class projection (indent-2 vs flush, mutually exclusive)
      const hasIndentClass = toElement.classList.contains('inkchapter-paragraph-effective-indent-2')
      const hasFlushClass = toElement.classList.contains('inkchapter-paragraph-effective-flush')
      expectedEffectiveMode = effective
      actualEffectiveMode = hasIndentClass ? 'indent-2' : hasFlushClass ? 'flush' : 'none'
      const effectiveModeMatches = effective === 'indent-2'
        ? (hasIndentClass && !hasFlushClass)
        : (hasFlushClass && !hasIndentClass)

      // Layer 2 — computed px (2em = fontSize*2 for indent-2; 0 for flush), ≤0.5px tolerance
      visualFontSize = parseFloat(window.getComputedStyle(toElement).fontSize) || 16
      expectedComputedIndent = effective === 'indent-2' ? visualFontSize * 2 : 0

      // R58.7 A1 empty-paragraph fix: an empty-equivalent candidate projects its
      // visual indent via padding-inline-start (the `:empty` CSS sets text-indent:0),
      // so text-indent computes to 0px. Read padding-left for empty-equivalent,
      // keep text-indent for everything else. Reuses isEmptyEquivalentParagraph
      // (which rejects whitespace-only / NBSP / unknown nested content).
      const candidateEmptyEquivalent = isEmptyEquivalentParagraph(toElement)
      const candidateComputedStyle = window.getComputedStyle(toElement)
      actualComputedIndent = computeCanonicalTransferComputedIndent(toElement, candidateComputedStyle)
      const computedMatches = Math.abs(actualComputedIndent - expectedComputedIndent) <= 0.5

      visualTransfer = effectiveModeMatches && computedMatches
      expectedIndent = `${expectedComputedIndent}px`
      actualIndent = `${actualComputedIndent}px`

      emitRuntimeAudit('CANONICAL-VISUAL-VERIFY', {
        recordId,
        expectedEffectiveMode,
        actualEffectiveMode,
        fontSize: visualFontSize,
        expectedComputedIndent,
        actualComputedIndent,
        effectiveModeMatches,
        computedMatches,
        candidateEmptyEquivalent,
        overall: visualTransfer,
      })
    }

    // ── VERIFY: projection must pass BEFORE identity commit ──
    const projectionVerified = semanticTransfer && visualTransfer
    emitRuntimeAudit('PROJECTION-VERIFY', {
      recordId,
      semanticTransfer,
      visualTransfer,
      newOwnerSemantic,
      expectedIndent,
      actualIndent,
      overall: projectionVerified,
    })

    if (!projectionVerified) {
      console.error(
        `[InkChapter] CANONICAL-TRANSFER-PROJECTION-FAIL: ` +
        `recordId=${recordId} ` +
        `recordMode=${recordMode} ` +
        `newOwnerSemantic=${newOwnerSemantic} ` +
        `expectedIndent=${expectedIndent} ` +
        `actualIndent=${actualIndent} ` +
        `reason=${!semanticTransfer ? 'SEMANTIC_MISMATCH' : 'VISUAL_MISMATCH'} ` +
        `decision=BLOCK`,
      )
      // Do NOT commit identity — return failure immediately
      this.lastCanonicalContinuityOutcome = {
        overall: false,
        recordId,
        semanticTransfer,
        visualTransfer,
        identityTransfer: false,
        failReason: !semanticTransfer ? 'projection-semantic-mismatch' : 'projection-visual-mismatch',
      }
      return {
        success: false,
        canonicalRecordId: recordId,
        fromRuntimeId,
        toRuntimeId,
        stateBefore: 'CURRENT_LIVE',
        stateAfter: 'CURRENT_LIVE',
        generationBefore: transferPlan.generation,
        generationAfter: transferPlan.generation,
        oldOwnerInvalidated: false,
        newOwnerEstablished: false,
        recordCountBefore: 0,
        recordCountAfter: 0,
        failReason: !semanticTransfer ? 'projection-semantic-mismatch' : 'projection-visual-mismatch',
      }
    }

    // ── COMMIT IDENTITY: Only after projection verified ──
    this.canonicalRegistry.markAwaitingTransfer(recordId, handoffId, reason, scopeId)
    const result = this.canonicalRegistry.transferCanonicalBinding(
      recordId, toElement, toRuntimeId, reason, scopeId,
    )

    // ── R58.7 Step 3: ROLLBACK on identity commit failure ──
    if (!result.success) {
      // Old owner is physically disconnected after TOP_LEVEL_SPLIT.
      // Do NOT restore fake live binding to disconnected element.
      const oldOwnerConnected = fromElement.isConnected

      // 1. Rollback candidate: restore ALL 4 pre-projection fields exactly.
      // 1a. Semantic attribute (data-inkchapter-indent-mode)
      if (preCandidateSemantic !== 'auto') {
        setParagraphIndentMode(
          toElement,
          preCandidateSemantic as 'force-indent' | 'force-flush',
          'W-CANONICAL-ROLLBACK-SEMANTIC',
        )
      } else {
        toElement.removeAttribute('data-inkchapter-indent-mode')
      }

      // 1b. Effective indent class (mutually exclusive)
      toElement.classList.remove('inkchapter-paragraph-effective-indent-2')
      toElement.classList.remove('inkchapter-paragraph-effective-flush')
      if (preCandidateEffectiveIndentClass === 'indent-2') {
        toElement.classList.add('inkchapter-paragraph-effective-indent-2')
      } else if (preCandidateEffectiveIndentClass === 'flush') {
        toElement.classList.add('inkchapter-paragraph-effective-flush')
      }

      // 1c. Inline text-indent style (exact value)
      toElement.style.textIndent = preCandidateInlineTextIndent

      // 2. Verify ALL 4 fields restored
      const semanticRestored =
        (toElement.getAttribute('data-inkchapter-indent-mode') ?? 'auto') === preCandidateSemantic
      const currentEffectiveIndentClass = (
        toElement.classList.contains('inkchapter-paragraph-effective-indent-2') ? 'indent-2'
        : toElement.classList.contains('inkchapter-paragraph-effective-flush') ? 'flush'
        : 'none'
      )
      const classRestored = currentEffectiveIndentClass === preCandidateEffectiveIndentClass
      const inlineStyleRestored = toElement.style.textIndent === preCandidateInlineTextIndent
      const computedIndentRestored = window.getComputedStyle(toElement).textIndent
        .replace(/\s+/g, '').toLowerCase()
        === preCandidateComputedIndent.replace(/\s+/g, '').toLowerCase()

      // 3. Registry: keep CURRENT_AWAITING_TRANSFER (NOT fake live binding, NOT historical resolver)
      const preTransferGeneration = transferPlan.generation
      const registryMeta = this.canonicalRegistry.getRuntimeMeta(recordId)
      const registryState = registryMeta?.state ?? 'CURRENT_AWAITING_TRANSFER'
      const currentRuntimeId = registryMeta?.currentRuntimeId ?? 'none'
      const previousRuntimeId = registryMeta?.previousRuntimeId ?? 'unknown'
      const generationUnchanged = (registryMeta?.generation ?? 0) === preTransferGeneration
      const fakeLiveBinding = registryState === 'CURRENT_LIVE' && !oldOwnerConnected
      const historicalResolverUsed = registryState === 'PERSISTED_HISTORICAL'

      const overall = semanticRestored && classRestored && inlineStyleRestored &&
        computedIndentRestored && !fakeLiveBinding && !historicalResolverUsed &&
        registryState === 'CURRENT_AWAITING_TRANSFER' &&
        currentRuntimeId === 'none' &&
        previousRuntimeId === fromRuntimeId &&
        generationUnchanged

      console.error(
        `[InkChapter] CANONICAL-TRANSFER-ROLLBACK-AUDIT: ` +
        `recordId=${recordId} ` +
        `oldOwnerConnected=${oldOwnerConnected} ` +
        `semanticRestored=${semanticRestored} ` +
        `classRestored=${classRestored} ` +
        `inlineStyleRestored=${inlineStyleRestored} ` +
        `computedIndentRestored=${computedIndentRestored} ` +
        `registryState=${registryState} ` +
        `currentRuntimeId=${currentRuntimeId} ` +
        `previousRuntimeId=${previousRuntimeId} ` +
        `generationUnchanged=${generationUnchanged} ` +
        `fakeLiveBinding=${fakeLiveBinding} ` +
        `historicalResolverUsed=${historicalResolverUsed} ` +
        `overall=${overall} ` +
        `reason=${result.failReason ?? 'identity-commit-failed'}`,
      )
    }

    // ── FINAL AUDIT ──
    emitRuntimeAudit('CANONICAL-TRANSFER-FINAL-AUDIT', {
      recordId,
      oldOwnerRuntimeId: result.fromRuntimeId,
      newOwnerRuntimeId: result.toRuntimeId,
      recordMode,
      newOwnerSemantic,
      expectedIndent,
      actualIndent,
      identityTransfer: result.success,
      semanticTransfer,
      visualTransfer,
      overall: semanticTransfer && visualTransfer && result.success,
    })

    emitRuntimeAudit('AWAITING-TRANSFER-LEAK-AUDIT', {
      recordId,
      awaitingCount: this.canonicalRegistry.getAwaitingTransferCount(),
      activeHandoffCount: this.activeLiveReplacementTickets.size,
      transferSuccess: result.success,
    })

    console.info(
      `[InkChapter] CANONICAL-BINDING-TRANSFER: ` +
      `canonicalRecordId=${result.canonicalRecordId} ` +
      `fromRuntimeId=${result.fromRuntimeId} ` +
      `toRuntimeId=${result.toRuntimeId} ` +
      `stateBefore=${result.stateBefore} ` +
      `stateAfter=${result.stateAfter} ` +
      `generationBefore=${result.generationBefore} ` +
      `generationAfter=${result.generationAfter} ` +
      `oldOwnerInvalidated=${result.oldOwnerInvalidated} ` +
      `newOwnerEstablished=${result.newOwnerEstablished} ` +
      `recordCountBefore=${result.recordCountBefore} ` +
      `recordCountAfter=${result.recordCountAfter} ` +
      `reason=${reason}`,
    )

    this.lastCanonicalContinuityOutcome = {
      overall: semanticTransfer && visualTransfer && result.success,
      recordId,
      semanticTransfer,
      visualTransfer,
      identityTransfer: result.success,
      failReason: result.failReason ?? null,
    }
    return result
  }

  // ── Normal Enter Trace: T0 snapshot + T8 final ──────────

  /**
   * Save T0 snapshot (for next cycle's comparison) and record T8 final state.
   * Called at the end of every doRefresh when trace is active.
   */
  private captureTraceEndOfDoRefresh(root: HTMLElement): void {
    if (!getTraceState().active) return

    safeTrace(() => {
      const docKey = this.getDocumentKey()

      // ── T8: Final visual state ──
      let t8Target: HTMLElement | null = null
      // With WeakMap-based identity, we look for the element that has the trace ID
      // stored in the WeakMap (not DOM dataset). For now, find any force-indent paragraph.
      const allParas = collectContentParagraphs(root)
      for (const p of allParas) {
        if (p.classList.contains('inkchapter-paragraph-effective-indent-2')) {
          t8Target = p
          break
        }
      }
      traceT8_FinalState({
        targetElement: summarizeElement(t8Target),
        targetClass: t8Target?.className ? String(t8Target.className) : null,
        targetDataMode: t8Target?.getAttribute('data-inkchapter-indent-mode') ?? null,
        computedTextIndent: t8Target ? getComputedIndent(t8Target) : 'no-target',
        selectionCurrentBlock: summarizeElement(resolveCurrentBlockFromSelection(root)),
      })

      // ── Save T0 snapshot for next cycle ──
      let aPara: HTMLElement | null = null
      let aOrdinal = -1
      let aPrev: HTMLElement | null = null
      let aNext: HTMLElement | null = null
      for (let i = 0; i < allParas.length; i++) {
        if (allParas[i].classList.contains('inkchapter-paragraph-effective-indent-2')) {
          aPara = allParas[i]
          aOrdinal = i
          aPrev = i > 0 ? allParas[i - 1] : null
          aNext = i < allParas.length - 1 ? allParas[i + 1] : null
          // WeakMap identity — no DOM mutation
          break
        }
      }

      const overrides = this.inMemoryOverrides.get(docKey ?? '') ?? []
      let targetOverride: ParagraphIndentOverrideRecord | null = null
      if (aPara) {
        targetOverride = overrides.find(o => {
          const r = resolveParagraphAnchor(o.anchor, allParas)
          return r?.index === aOrdinal
        }) ?? null
      }

      this.lastTraceSnapshot = {
        documentKey: docKey,
        editorRootIdentity: identifyNode(root),
        aElement: summarizeElement(aPara),
        aOrdinal,
        aPreviousBlockSummary: summarizeElement(aPrev),
        aNextBlockSummary: summarizeElement(aNext),
        aTextNormalized: aPara?.textContent?.trim() ?? '',
        selection: summarizeSelection(),
        overrideRecordId: targetOverride?.id ?? null,
        overrideMode: targetOverride?.mode ?? null,
        overrideTemporary: targetOverride?.temporary ?? null,
        overrideAnchor: targetOverride?.anchor ? {
          textHash: targetOverride.anchor.textHash ?? null,
          lastKnownOrdinal: targetOverride.anchor.lastKnownOrdinal,
          occurrence: targetOverride.anchor.occurrence ?? null,
        } : null,
        inMemoryOverrideCount: overrides.length,
        sidecarWritePending: this.sidecarWritePending !== null,
      }
    })
  }

  // ── Two-Pass Rehydrate Pipeline (r53 P0-A) ──────────────────────

  /**
   * Phase 1: Resolve ALL sidecar records into candidates.
   * Phase 2: Group candidates by target paragraph ownership.
   * Phase 3: Build plan (winners + blocked groups).
   *
   * NO semantic/visual/sidecar/caret writers during Phase 1/2.
   * This eliminates the first-candidate leak where the first record
   * is applied before later records for the same paragraph are discovered.
   *
   * Shared by both rehydrateParagraphIndentOverrides and
   * reconstructParagraphOverridesFromSidecar.
   */
  private resolveParagraphOverrideRehydratePlan(
    docKey: string,
    docPath: string,
    allRecords: ParagraphIndentOverrideRecord[],
    allParas: HTMLElement[],
    source: 'rehydrate' | 'reconstruct',
  ): ParagraphRehydratePlan {
    const planId = `plan-${source}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`
    const resolvedCandidates: RehydrateResolvedCandidate[] = []
    let phase1WriterCount = 0

    // ── Phase 1: RESOLVE ALL — NO writers allowed ──
    // Promote temporary anchors first (same logic as before)
    let dirty = false
    for (const o of allRecords) {
      if (!o.temporary) continue
      if (o.mode !== 'force-indent' && o.mode !== 'force-flush') continue
      const resolved = resolveParagraphAnchor(o.anchor, allParas)
      if (resolved) {
        const para = allParas[resolved.index]
        if (para && para.textContent?.trim()) {
          // ── R58.6.2: Proof-Before-Mutation — requires LiveOwnershipProof ──
          const promoMeta = this.canonicalRegistry.getRuntimeMeta(o.id)
          if (promoMeta && promoMeta.state === 'PERSISTED_HISTORICAL') {
            continue // Historical records cannot be promoted
          }

          // Resolve proof from the matched paragraph
          const docKeyPromo = this.getDocumentKey() ?? ''
          const paraRtId = this.getParagraphRuntimeId(para)

          if (promoMeta?.state === 'CURRENT_LIVE') {
            // Must have valid LiveOwnershipProof for live promotion
            const proof = this.canonicalRegistry.resolveLiveOwnershipProof(
              para, docKeyPromo, paraRtId,
            )
            if (!proof) {
              console.info(
                `[InkChapter] PROMOTION-LIFECYCLE-VIOLATION: ` +
                `recordId=${o.id} ` +
                `state=${promoMeta.state} ` +
                `reason=NO_LIVE_OWNERSHIP_PROOF ` +
                `decision=BLOCK`,
              )
              continue
            }

            const promoResult = this.canonicalRegistry.promoteExistingByRecordId(
              o.id, paraRtId, para, docKeyPromo,
            )
            if (!promoResult.ok) {
              console.error(
                `[InkChapter] PROMOTION-LIFECYCLE-VIOLATION: ` +
                `recordId=${o.id} ` +
                `state=${promoMeta.state} ` +
                `reason=${promoResult.reason} ` +
                `decision=BLOCK`,
              )
              continue
            }

            // Only now: registry authorized → apply
            const newAnchor = createParagraphAnchor(resolved.index, allParas)
            o.anchor = newAnchor
            o.temporary = false
            dirty = true

            console.info(
              `[InkChapter] CANONICAL-RECORD-PROMOTION: recordId=${o.id} ` +
              `stateBefore=${promoResult.stateBefore} ` +
              `stateAfter=CURRENT_LIVE ` +
              `bindingVerified=true ` +
              `elementConnected=true ` +
              `generationMatches=true ` +
              `runtimeIdMatches=true ` +
              `temporaryBefore=true ` +
              `temporaryAfter=false ` +
              `recordCount=${allRecords.length} ` +
              `decision=PROMOTE`,
            )
          } else {
            // Not in registry or not CURRENT_LIVE — skip promotion
            continue
          }
        }
      }
    }

    // Resolve ALL explicit records
    for (const o of allRecords) {
      if (o.mode !== 'force-indent' && o.mode !== 'force-flush') continue

      // ── R58.2: Lifecycle eligibility gate ────────────────────────────
      const meta = this.canonicalRegistry.getRuntimeMeta(o.id)
      if (meta) {
        switch (meta.state) {
          case 'CURRENT_LIVE':
            // Only MATCH-LIVE-BINDING allowed
            if (meta.currentElement && meta.currentElement.isConnected) {
              const boundElement = meta.currentElement
              const paraIdx = allParas.indexOf(boundElement)
              if (paraIdx >= 0) {
                resolvedCandidates.push({
                  recordId: o.id,
                  recordMode: o.mode,
                  record: { ...o },
                  targetParagraph: boundElement,
                  targetParagraphIndex: paraIdx,
                  strategy: 'MATCH-LIVE-BINDING' as any,
                  confidence: RehydrateConfidence.EXACT,
                  score: 200,
                  candidateCountAtGroup: 0,
                })
                console.info(
                  `[InkChapter] MATCH-LIVE-BINDING: recordId=${o.id} ` +
                  `targetRuntimeId=${this.getParagraphRuntimeId(boundElement)} ` +
                  `targetOrdinal=${paraIdx} ` +
                  `candidateSource=LIVE candidateCount=1`,
                )
              }
            } else {
              // CURRENT_LIVE but element disconnected → should have been AWAITING_TRANSFER
              // Mark it now and skip
              console.info(
                `[InkChapter] CURRENT-LIVE-DISCONNECTED: recordId=${o.id} ` +
                `reason=element disconnected but state still CURRENT_LIVE — marking AWAITING_TRANSFER`,
              )
              this.canonicalRegistry.markAwaitingTransfer(o.id, undefined, undefined,
                this.documentContext.scopeId ?? undefined)
            }
            continue // Do NOT enter persistent resolver

          case 'CURRENT_AWAITING_TRANSFER':
            // ZERO candidates — must wait for handoff to resolve replacement
            console.info(
              `[InkChapter] REHYDRATE-CANDIDATE: recordId=${o.id} ` +
              `state=CURRENT_AWAITING_TRANSFER candidateCount=0 ` +
              `reason=awaiting handoff transfer — no heuristic candidates`,
            )
            continue

          case 'CURRENT_RETIRED':
            // ZERO candidates
            console.info(
              `[InkChapter] REHYDRATE-CANDIDATE: recordId=${o.id} ` +
              `state=CURRENT_RETIRED candidateCount=0 reason=retired`,
            )
            continue

          case 'PERSISTED_HISTORICAL':
            // Fall through to persistent resolver below
            break
        }
      } else {
        // Not in registry — treat as PERSISTED_HISTORICAL (loaded before registry existed)
        // Register it now for future tracking
        this.canonicalRegistry.registerPersistedHistorical(o, docKey)
      }

      // ── PERSISTED_HISTORICAL: Only this path enters persistent heuristic resolver ──

      const resolved = resolveParagraphAnchor(o.anchor, allParas)
      if (!resolved) continue

      const para = allParas[resolved.index]
      if (!para) continue

      // ── PF5: Historical identity isolation — text-only match is NOT sufficient ──
      // A PERSISTED_HISTORICAL record must not bind to a session-born paragraph
      // merely because visible text (textHash) collides. Require structural
      // neighborhood corroboration for textHash 'exact' matches.
      if (resolved.confidence === 'exact') {
        const histIdentity = evaluateHistoricalRehydrateIdentity(o.anchor, resolved.index, allParas)
        if (histIdentity.decision !== 'ACCEPT_STRONG_IDENTITY') {
          emitRuntimeAudit('HISTORICAL-REHYDRATE-CANDIDATE', {
            recordId: o.id,
            recordState: 'PERSISTED_HISTORICAL',
            recordMode: o.mode,
            candidateRuntimeId: this.getParagraphRuntimeId(para),
            candidateText: getUserVisibleParagraphText(para).slice(0, 80),
            matchStrategy: RehydrateMatchStrategy.EXACT_ANCHOR,
            identityProof: false,
            sessionBorn: false,
            currentLiveOwnerPresent: false,
            decision: histIdentity.decision,
            reason: histIdentity.reason,
          })
          console.info(
            `[InkChapter] HISTORICAL-REHYDRATE-REJECT: recordId=${o.id} ` +
            `candidateRuntimeId=${this.getParagraphRuntimeId(para)} ` +
            `decision=${histIdentity.decision} reason=${histIdentity.reason} ` +
            `duplicateTextCount=${histIdentity.duplicateTextCount}`,
          )
          continue
        }
      }

      const matchConfidence = anchorConfidenceToRehydrateConfidence(resolved.confidence)

      let matchStrategy: typeof RehydrateMatchStrategy[keyof typeof RehydrateMatchStrategy]
      switch (resolved.confidence) {
        case 'exact':
          matchStrategy = o.anchor.textHash ? RehydrateMatchStrategy.EXACT_ANCHOR : RehydrateMatchStrategy.INDEX_FALLBACK
          break
        case 'high':
          matchStrategy = RehydrateMatchStrategy.NORMALIZED_ANCHOR
          break
        case 'medium':
          matchStrategy = RehydrateMatchStrategy.PROXIMITY
          break
        case 'fallback':
          matchStrategy = RehydrateMatchStrategy.INDEX_FALLBACK
          break
      }

      const score = resolved.confidence === 'exact' ? 100 : resolved.confidence === 'high' ? 5 : resolved.confidence === 'medium' ? 3 : 1

      resolvedCandidates.push({
        recordId: o.id,
        recordMode: o.mode,
        record: { ...o },
        targetParagraph: para,
        targetParagraphIndex: resolved.index,
        strategy: matchStrategy,
        confidence: matchConfidence,
        score,
        candidateCountAtGroup: 0, // filled in Phase 2
      })
    }

    // ── Phase 1 invariant check ──
    if (phase1WriterCount > 0) {
      logger.error(`REHYDRATE_PHASE1_WRITER_VIOLATION: writers=${phase1WriterCount} — HARD FAIL`)
    }

    // ── R58.6.1: Live Owner Dominance — suppress historical for LIVE-occupied targets ──
    const liveOccupiedTargets = new Set<number>()
    for (const c of resolvedCandidates) {
      if (c.strategy === ('MATCH-LIVE-BINDING' as any)) {
        liveOccupiedTargets.add(c.targetParagraphIndex)
      }
    }
    if (liveOccupiedTargets.size > 0) {
      const suppressedIds: string[] = []
      const keptCandidates = resolvedCandidates.filter(c => {
        if (liveOccupiedTargets.has(c.targetParagraphIndex) && c.strategy !== ('MATCH-LIVE-BINDING' as any)) {
          suppressedIds.push(c.recordId)
          console.info(
            `[InkChapter] HISTORICAL-CANDIDATE-SUPPRESSED-BY-LIVE-OWNER: ` +
            `targetRuntimeId=index-${c.targetParagraphIndex} ` +
            `liveRecordId=${resolvedCandidates.find(cc => cc.strategy === ('MATCH-LIVE-BINDING' as any) && cc.targetParagraphIndex === c.targetParagraphIndex)?.recordId ?? 'unknown'} ` +
            `historicalCandidateRecordIds=[${c.recordId}] ` +
            `suppressedCount=1 ` +
            `reason=exact-live-owner`,
          )
          return false
        }
        return true
      })
      // Replace the candidate list
      resolvedCandidates.length = 0
      resolvedCandidates.push(...keptCandidates)
    }

    // ── R58.2: REHYDRATE-CANDIDATE-DEDUPE ──
    // For same recordId + targetRuntimeId, keep only highest priority strategy
    const dedupeMap = new Map<string, RehydrateResolvedCandidate>()
    const strategyPriority: Record<string, number> = {
      'MATCH-LIVE-BINDING': 10,
      'MATCH-RECORD-ID': 9,
      'MATCH-EXACT-ANCHOR': 8,
      'MATCH-NORMALIZED-ANCHOR': 7,
      'MATCH-PROMOTED-ANCHOR': 6,
      'MATCH-INDEX-FALLBACK': 5,
      'MATCH-PROXIMITY': 4,
      'MATCH-LEGACY': 3,
      'MATCH-NONE': 0,
    }
    let duplicatesRemoved = 0
    for (const c of resolvedCandidates) {
      const key = `${c.recordId}::${c.targetParagraphIndex}`
      const existing = dedupeMap.get(key)
      const cPriority = strategyPriority[c.strategy] ?? 0
      const ePriority = existing ? (strategyPriority[existing.strategy] ?? 0) : 0
      if (existing && cPriority <= ePriority) {
        duplicatesRemoved++
        console.info(
          `[InkChapter] REHYDRATE-CANDIDATE-DEDUPE: recordId=${c.recordId} ` +
          `targetRuntimeId=${this.getParagraphRuntimeId(c.targetParagraph)} ` +
          `strategiesBefore=[${existing.strategy},${c.strategy}] ` +
          `strategyKept=${existing.strategy} ` +
          `duplicatesRemoved=${duplicatesRemoved}`,
        )
        continue
      }
      if (existing) {
        duplicatesRemoved++
        console.info(
          `[InkChapter] REHYDRATE-CANDIDATE-DEDUPE: recordId=${c.recordId} ` +
          `targetRuntimeId=${this.getParagraphRuntimeId(c.targetParagraph)} ` +
          `strategiesBefore=[${existing.strategy},${c.strategy}] ` +
          `strategyKept=${c.strategy} ` +
          `duplicatesRemoved=${duplicatesRemoved}`,
        )
      }
      dedupeMap.set(key, c)
    }
    const dedupedCandidates = Array.from(dedupeMap.values())

    // ── Phase 2: GROUP OWNERSHIP ──
    const groups = buildRehydrateOwnershipGroups(dedupedCandidates)

    // Update candidateCountAtGroup for all candidates
    for (const group of groups) {
      for (const c of group.candidates) {
        c.candidateCountAtGroup = group.candidateCount
      }
    }

    // ── Phase 3: DECIDE — determine winners and blocked groups ──
    // For single-owner groups, also run match safety check
    const winners: RehydrateResolvedCandidate[] = []
    const blockedGroups: RehydrateOwnershipGroup[] = []

    for (const group of groups) {
      if (group.decision === 'block') {
        blockedGroups.push(group)
        // ── R58.2: Multi-owner lifecycle state check ──
        const lifecycleStates = group.candidates.map(c => {
          const m = this.canonicalRegistry.getRuntimeMeta(c.recordId)
          return m?.state ?? 'UNKNOWN'
        })
        const currentSessionCount = lifecycleStates.filter(s => s !== 'PERSISTED_HISTORICAL' && s !== 'UNKNOWN').length
        if (currentSessionCount > 0) {
          console.error(
            `[InkChapter] REHYDRATE-BLOCK-CURRENT-SESSION-MULTI-OWNER: ` +
            `target=${group.targetElementIdentity} ` +
            `candidateCount=${group.candidateCount} ` +
            `candidateRecordIds=[${group.candidateRecordIds.join(',')}] ` +
            `candidateLifecycleStates=[${lifecycleStates.join(',')}] ` +
            `currentSessionCandidateCount=${currentSessionCount} ` +
            `ACTION=HARD_STOP`,
          )
        }
        // Log REHYDRATE-GROUP for blocked
        logger.info(`REHYDRATE-GROUP: target=${group.targetElementIdentity} targetIndex=${group.targetParagraphIndex} candidateRecordIds=[${group.candidateRecordIds.join(',')}] candidateModes=[${group.candidateModes.join(',')}] candidateCount=${group.candidateCount} candidateLifecycleStates=[${lifecycleStates.join(',')}] decision=BLOCK reason=${group.reason}`)
        continue
      }

      // Single-owner: run match safety
      if (!group.winner) continue
      const winner = group.winner

      const currentSemantic = getParagraphIndentMode(winner.targetParagraph)

      const provenance: RehydrateMatchProvenance = {
        timestamp: Date.now(),
        rehydrateAttemptId: `${planId}-${winner.recordId}`,
        txnId: this.activeEnterTransaction?.id ?? null,
        observationId: null,
        targetParagraphIdentity: getElementIdentity(winner.targetParagraph),
        targetText: winner.targetParagraph.textContent?.slice(0, 80) ?? null,
        targetUserVisibleText: getUserVisibleParagraphText(winner.targetParagraph) || null,
        currentSemantic,
        candidateRecords: [],
        candidateCount: 1,
        selectedRecordId: winner.recordId,
        selectedRecordMode: winner.recordMode,
        matchStrategy: winner.strategy,
        matchConfidence: winner.confidence,
        ambiguityDetected: false,
        rehydrateBlocked: false,
      }

      const blockReason = evaluateRehydrateSafety(provenance)
      if (blockReason) {
        group.decision = 'block'
        group.reason = blockReason
        blockedGroups.push(group)
        logger.info(`REHYDRATE-GROUP: target=${group.targetElementIdentity} candidateCount=1 decision=BLOCK reason=${blockReason}`)
        continue
      }

      winners.push(winner)
      logger.info(`REHYDRATE-GROUP: target=${group.targetElementIdentity} candidateCount=1 decision=APPLY winner=${winner.recordId} mode=${winner.recordMode}`)
    }

    // ── REHYDRATE-PLAN summary ──
    logger.info(`REHYDRATE-PLAN: planId=${planId} documentKey=${docKey} source=${source} recordCount=${allRecords.length} resolvedCandidateCount=${dedupedCandidates.length} groupCount=${groups.length} winnerCount=${winners.length} blockedGroupCount=${blockedGroups.length} phase1WriterCount=${phase1WriterCount}`)

    return {
      planId,
      documentKey: docKey,
      allRecords,
      resolvedCandidates,
      groups,
      winners,
      blockedGroups,
      phase1WriterCount,
    }
  }

  /**
   * Phase 4: Apply safe winners from the rehydrate plan.
   * Only winners with group.length===1 + match safety pass are applied.
   * Also handles anchor repair and sidecar persistence.
   */
  private applyParagraphRehydratePlan(plan: ParagraphRehydratePlan): void {
    if (plan.winners.length === 0) return

    const root = this.adapter.getEditorRoot()
    if (!root) return
    const allParas = collectContentParagraphs(root)
    const settings = this.getParagraphLayoutSettings()

    // ── R58.7: REHYDRATE-SELECTION-AUDIT — read-only before/after sampling ──
    this.rehydrateApplyCount++
    const selectionBefore = resolveSelectionTruth(
      root,
      (el: object) => this.getParagraphRuntimeId(el as HTMLElement),
      'REHYDRATE-SELECTION-BEFORE',
    )

    let dirty = false
    let applyAttemptedCount = 0
    let semanticChangedCount = 0
    let classChangedCount = 0
    let inlineStyleChangedCount = 0

    for (const winner of plan.winners) {
      const para = winner.targetParagraph
      if (!para?.isConnected) continue

      // ── R58: REHYDRATE-APPLY provenance ────────────────────────────
      const targetText = getUserVisibleParagraphText(para)
      const semanticBefore = getParagraphIndentMode(para)
      const classBefore = Array.from(para.classList).sort().join(',')
      const styleBefore = para.style.textIndent
      console.info(
        `[InkChapter] REHYDRATE-APPLY: planId=${plan.planId} ` +
        `recordId=${winner.recordId} targetRuntimeId=${this.getParagraphRuntimeId(para)} ` +
        `targetOrdinal=${winner.targetParagraphIndex} targetText="${targetText}" ` +
        `semanticBefore=${semanticBefore} semanticAfter=${winner.recordMode} ` +
        `matchStrategy=${winner.strategy}`,
      )

      // ── R58.2: SINGLE-DOT-CURRENT-SESSION-CANDIDATE gate ──────────
      if (targetText === '。' && semanticBefore === 'auto' &&
          winner.strategy !== 'MATCH-LIVE-BINDING' as any) {
        // Check if this is a current-session record (should not happen with lifecycle gate,
        // but this is the final safety net)
        const candMeta = this.canonicalRegistry.getRuntimeMeta(winner.recordId)
        const isCurrentSession = candMeta && candMeta.state !== 'PERSISTED_HISTORICAL'
        if (isCurrentSession) {
          console.error(
            `[InkChapter] SINGLE-DOT-CURRENT-SESSION-CANDIDATE: ` +
            `recordId=${winner.recordId} ` +
            `state=${candMeta!.state} ` +
            `origin=${candMeta!.origin} ` +
            `targetText="。" ` +
            `matchStrategy=${winner.strategy} ` +
            `ACTION=HARD_STOP`,
          )
          continue
        }

        console.info(
          `[InkChapter] SINGLE-DOT-WRONG-APPLY: recordId=${winner.recordId} ` +
          `targetRuntimeId=${this.getParagraphRuntimeId(para)} ` +
          `targetText="。" semanticBefore=auto ` +
          `recordMode=${winner.recordMode} matchStrategy=${winner.strategy} ` +
          `candidateSource=rehydrate ` +
          `ACTION=BLOCKED`,
        )
        continue // Block this winner — do NOT apply
      }

      const rehydrateCtx: RehydrateContext = {
        source: plan.allRecords === this.inMemoryOverrides.get(plan.documentKey) ? 'rehydrate' : 'sidecar-reconstruct',
        semanticWriterId: plan.allRecords === this.inMemoryOverrides.get(plan.documentKey)
          ? WriterIds.REHYDRATE_SEMANTIC
          : WriterIds.SIDECAR_RECONSTRUCT_SEMANTIC,
        visualWriterId: plan.allRecords === this.inMemoryOverrides.get(plan.documentKey)
          ? WriterIds.REHYDRATE_VISUAL
          : WriterIds.SIDECAR_RECONSTRUCT_VISUAL,
      }

      // Atomic rehydrate: semantic + visual in ONE synchronous call
      applyAttemptedCount++
      rehydrateParagraphIndentState(para, winner.recordMode, settings, rehydrateCtx)

      // R58.7: count material DOM mutations (semantic / class / inline style)
      const semanticAfter = getParagraphIndentMode(para)
      const classAfter = Array.from(para.classList).sort().join(',')
      const styleAfter = para.style.textIndent
      if (semanticBefore !== semanticAfter) semanticChangedCount++
      if (classBefore !== classAfter) classChangedCount++
      if (styleBefore !== styleAfter) inlineStyleChangedCount++

      // ── R58.3: Live projection-only gate ──
      // CURRENT_LIVE records: projection only, NO anchor repair, NO canonical mutation
      const winnerMeta = this.canonicalRegistry.getRuntimeMeta(winner.recordId)
      const isCurrentLive = winnerMeta?.state === 'CURRENT_LIVE'

      if (isCurrentLive) {
        // Live projection only — no anchor repair, no dirty, no write
        console.info(
          `[InkChapter] REHYDRATE-WRITE-AUDIT: planId=${plan.planId} ` +
          `recordId=${winner.recordId} ` +
          `runtimeState=CURRENT_LIVE ` +
          `candidateSource=LIVE ` +
          `matchStrategy=${winner.strategy} ` +
          `dirty=false ` +
          `reason=live-projection-only ` +
          `writeScheduled=false`,
        )
        continue // Skip anchor repair for CURRENT_LIVE
      }

      // ── PERSISTED_HISTORICAL only: anchor repair allowed once ──
      // Auto-repair anchor (idempotent — only if materially changed)
      if (winner.targetParagraphIndex >= 0 && winner.targetParagraphIndex < allParas.length) {
        const newAnchor = updateParagraphAnchor(winner.record.anchor, winner.targetParagraphIndex, allParas)
        const oldAnchorNorm = JSON.stringify(winner.record.anchor)
        const newAnchorNorm = JSON.stringify(newAnchor)
        if (oldAnchorNorm !== newAnchorNorm) {
          // REHYDRATE-CANONICAL-MUTATION trace
          console.info(
            `[InkChapter] REHYDRATE-CANONICAL-MUTATION: planId=${plan.planId} ` +
            `recordId=${winner.recordId} ` +
            `runtimeState=${winnerMeta?.state ?? 'UNKNOWN'} ` +
            `candidateSource=PERSISTENT ` +
            `matchStrategy=${winner.strategy} ` +
            `mutationType=anchor-repair ` +
            `before=${oldAnchorNorm} ` +
            `after=${newAnchorNorm}`,
          )
          winner.record.anchor = newAnchor
          const orig = plan.allRecords.find(r => r.id === winner.recordId)
          if (orig) {
            orig.anchor = winner.record.anchor
            orig.temporary = !para.textContent?.trim()
          }
          dirty = true
        }
      }
    }

    // Persist repaired anchors to sidecar (debounced)
    if (dirty) {
      const docPath = this.ctx.getActiveFilePath?.() ?? 'unknown'
      this.scheduleSidecarWrite(plan.documentKey, docPath, [...plan.allRecords])

      // ── R59: REHYDRATE-WRITE-AUDIT ──────────────────────────────────
      console.info(
        `[InkChapter] REHYDRATE-WRITE-AUDIT: planId=${plan.planId} ` +
        `documentKey=${plan.documentKey} ` +
        `winners=${plan.winners.length} blocked=${plan.blockedGroups.length} ` +
        `recordCount=${plan.allRecords.length} ` +
        `dirty=${dirty} ` +
        `reason=anchor-repair ` +
        `writeScheduled=true`,
      )
    } else {
      console.info(
        `[InkChapter] REHYDRATE-WRITE-AUDIT: planId=${plan.planId} ` +
        `documentKey=${plan.documentKey} ` +
        `winners=${plan.winners.length} blocked=${plan.blockedGroups.length} ` +
        `recordCount=${plan.allRecords.length} ` +
        `dirty=${dirty} ` +
        `reason=no-anchor-repair-needed ` +
        `writeScheduled=false`,
      )
    }

    // ── R58.7: REHYDRATE-SELECTION-AUDIT (read-only) ──
    const actualDomWriteCount = semanticChangedCount + classChangedCount + inlineStyleChangedCount
    this.rehydrateDomWriteCount += actualDomWriteCount
    const rehydrateSource = plan.allRecords === this.inMemoryOverrides.get(plan.documentKey) ? 'rehydrate' : 'sidecar-reconstruct'
    const selectionAfterSync = resolveSelectionTruth(
      root,
      (el: object) => this.getParagraphRuntimeId(el as HTMLElement),
      'REHYDRATE-SELECTION-AFTER-SYNC',
    )
    emitRuntimeAudit('REHYDRATE-SELECTION-AUDIT', {
      planId: plan.planId,
      source: rehydrateSource,
      scopeId: this.documentContext.scopeId ?? 'unknown',
      selectionBeforeRuntimeId: selectionBefore.runtimeId ?? 'null',
      selectionBeforeOffset: selectionBefore.logicalOffset ?? 'null',
      selectionBeforeVisibleText: selectionBefore.paragraph ? getUserVisibleParagraphText(selectionBefore.paragraph) : '',
      winnerCount: plan.winners.length,
      blockedCount: plan.blockedGroups.length,
      rehydrateApplyCount: this.rehydrateApplyCount,
      applyAttemptedCount,
      semanticApplyAttempted: applyAttemptedCount,
      semanticActuallyChanged: semanticChangedCount,
      classApplyAttempted: applyAttemptedCount,
      classActuallyChanged: classChangedCount,
      inlineStyleApplyAttempted: applyAttemptedCount,
      inlineStyleActuallyChanged: inlineStyleChangedCount,
      decorationApplyAttempted: 0,
      decorationActuallyChanged: 0,
      actualDomWriteCount,
      selectionAfterSyncRuntimeId: selectionAfterSync.runtimeId ?? 'null',
      selectionAfterSyncOffset: selectionAfterSync.logicalOffset ?? 'null',
      selectionAfterMicrotaskRuntimeId: 'pending',
      selectionAfterMicrotaskOffset: 'pending',
      selectionAfterRAFRuntimeId: 'pending',
      selectionAfterRAFOffset: 'pending',
      selectionWriteAttemptedByRehydrate: false,
    })
    queueMicrotask(() => {
      const t = resolveSelectionTruth(root, (el: object) => this.getParagraphRuntimeId(el as HTMLElement), 'REHYDRATE-SELECTION-AFTER-MICROTASK')
      console.info(
        `[InkChapter] REHYDRATE-SELECTION-AFTER-MICROTASK: planId=${plan.planId} ` +
        `runtimeId=${t.runtimeId ?? 'null'} logicalOffset=${t.logicalOffset ?? 'null'} visibleText=${t.paragraph ? getUserVisibleParagraphText(t.paragraph) : ''}`,
      )
    })
    requestAnimationFrame(() => {
      const t = resolveSelectionTruth(root, (el: object) => this.getParagraphRuntimeId(el as HTMLElement), 'REHYDRATE-SELECTION-AFTER-RAF')
      console.info(
        `[InkChapter] REHYDRATE-SELECTION-AFTER-RAF: planId=${plan.planId} ` +
        `runtimeId=${t.runtimeId ?? 'null'} logicalOffset=${t.logicalOffset ?? 'null'} visibleText=${t.paragraph ? getUserVisibleParagraphText(t.paragraph) : ''}`,
      )
    })
  }

  /**
   * Rehydrate explicit force-indent overrides from in-memory registry.
   * Called before every refreshParagraphIndentStyles so that explicit
   * overrides survive Normal Enter / paragraph split / DOM rebuild.
   *
   * Also promotes temporary anchors (empty paragraph) to stable anchors
   * when the user has typed text, and triggers a debounced sidecar write
   * to persist stable anchors for save/reopen round-trip.
   *
   * r53 P0-A: Uses two-pass pipeline — RESOLVE ALL → GROUP → DECIDE → APPLY.
   */
  private rehydrateParagraphIndentOverrides(root: HTMLElement): void {
    // ── P0-5: One-shot handoff check (replaces old Pending) ──────
    this.tryExecuteOneShotHandoff(Array.from(root.querySelectorAll('p')) as HTMLElement[])

    const docKey = this.getDocumentKey()
    if (!docKey) return
    const docPath = this.ctx.getActiveFilePath?.() ?? 'unknown'
    const overrides = this.inMemoryOverrides.get(docKey)
    if (!overrides || overrides.length === 0) return

    const allParas = collectContentParagraphs(root)
    if (allParas.length === 0) return

    // ── Build and apply the plan ──
    const plan = this.resolveParagraphOverrideRehydratePlan(
      docKey, docPath, overrides, allParas, 'rehydrate',
    )
    this.rehydratePlanCount++

    // ── R58.3: Sweep stale awaiting records ──
    const activeHandoffIds = new Set<string>()
    if (this.activeOneShotHandoff && !this.activeOneShotHandoff.consumed) {
      activeHandoffIds.add(this.activeOneShotHandoff.handoffId)
    }
    this.canonicalRegistry.sweepStaleAwaitingRecords(activeHandoffIds)

    this.applyParagraphRehydratePlan(plan)
  }

  /** Reconstruct runtime force-indent projections from sidecar metadata. */
  reconstructParagraphOverridesFromSidecar(): void {
    // R58.7 Phase A.1: Gate — persistence must be ready for sidecar load
    if (!this.assertPersistenceContextReady('rehydrate-sidecar')) return

    const docKey = this.getDocumentKey()
    if (!docKey) return

    const data = loadParagraphLayout(docKey)
    if (!data || data.paragraphOverrides.length === 0) {
      this.inMemoryOverrides.set(docKey, [])
      return
    }

    // Populate in-memory registry from sidecar (deep clone)
    const loadedOverrides = data.paragraphOverrides.map(o => ({ ...o }))
    this.inMemoryOverrides.set(docKey, loadedOverrides)

    // ── R58.2: Register all loaded records as PERSISTED_HISTORICAL ──
    for (const o of loadedOverrides) {
      this.canonicalRegistry.registerPersistedHistorical(o, docKey)
    }
    emitRuntimeAudit('SIDECAR-HISTORICAL-REGISTRATION', {
      documentKey: docKey,
      recordCount: loadedOverrides.length,
      state: 'PERSISTED_HISTORICAL',
    })

    const root = this.adapter.detectEditorRoot()
    if (!root) return

    // First, run legacy migration if markers exist in Markdown
    this.migrateLegacyMarkersIfPresent()

    const allParas = collectContentParagraphs(root)
    const docPath = this.ctx.getActiveFilePath?.() ?? 'unknown'

    // ── Two-Pass Pipeline: shared with rehydrateParagraphIndentOverrides ──
    const overrides = this.inMemoryOverrides.get(docKey)!
    const plan = this.resolveParagraphOverrideRehydratePlan(
      docKey, docPath, overrides, allParas, 'reconstruct',
    )
    this.rehydratePlanCount++
    this.applyParagraphRehydratePlan(plan)

    // ── P0-2: Only save when dirty (winners applied or anchors repaired) ──
    // Check if any anchor changed by comparing with original loaded data
    let reconstructDirty = false
    for (const o of loadedOverrides) {
      const orig = data.paragraphOverrides.find(r => r.id === o.id)
      if (!orig) { reconstructDirty = true; break }
      if (JSON.stringify(o.anchor) !== JSON.stringify(orig.anchor)) {
        reconstructDirty = true
        break
      }
    }
    if (reconstructDirty) {
      saveParagraphLayout(docKey, docPath, loadedOverrides)
    }
  }

  /** Migrate legacy HTML comment markers to sidecar if present. */
  private migrateLegacyMarkersIfPresent(): void {
    const markdown = this.ctx.getMarkdown?.()
    if (!markdown) return

    const { cleanMarkdown, overrides, migrated } = migrateLegacyIndentMarkers(markdown)
    if (!migrated) return

    // Merge with existing sidecar
    const docKey = this.getDocumentKey()
    const docPath = this.ctx.getActiveFilePath?.() ?? 'unknown'
    if (!docKey) return

    const existing = loadParagraphLayout(docKey)
    const existingOverrides = existing?.paragraphOverrides ?? []
    const merged = [...existingOverrides, ...overrides]
    saveParagraphLayout(docKey, docPath, merged)

    // Reload with clean Markdown (no markers)
    this.suppressParagraphCommandDetection = true
    try {
      if (this.ctx.reloadContentPreservingUndo) {
        this.ctx.reloadContentPreservingUndo(cleanMarkdown)
      } else if (this.ctx.reloadContent) {
        this.ctx.reloadContent(cleanMarkdown)
      }
    } finally {
      this.suppressParagraphCommandDetection = false
    }

    logger.info(`Migrated ${overrides.length} legacy marker(s) to sidecar`)
  }

  // ── Manual Semantic Diagnostic Command ──────────────────

  /**
   * Force-indent the paragraph at the current selection.
   *
   * This is a diagnostic entry point that completely bypasses the
   * shortcut producer (mutation observer, command token, Enter).
   * It directly tests: selection → resolveBlock → semantic setter → layout.
   *
   * If this command works but .. + Enter doesn't, the problem is
   * in the shortcut producer chain, not the semantic/render layer.
   *
   * Supports three modes via `setParagraphIndentMode`:
   *   'force-indent' | 'force-flush' | 'auto'
   */
  forceIndentCurrentParagraph(mode: 'force-indent' | 'force-flush' | 'auto' = 'force-indent'): boolean {
    const root = this.adapter.detectEditorRoot()
    if (!root) return false

    const block = resolveCurrentBlockFromSelection(root)
    if (!block) return false

    if (!isContentBlock(block)) return false

    // Use unified entry point — handles both runtime semantic and sidecar persistence
    this.applyParagraphIndentOverride(block, mode)

    return true
  }

  /** Get the effective heading layouts for the current document (physical H1-H6). */
  getEffectiveHeadingLayouts(mode?: import('./heading-structure').HeadingStructureMode): import('./heading-types').HeadingLayoutSettings | undefined {
    const settings = this.docContext.effectiveSettings
    const m = mode ?? resolveHeadingStructure(this.s).mode
    return resolveHeadingLayoutsForMode(settings, m)
  }

  /**
   * Save heading layout for the specified scope and level.
   * Automatically clears firstLineIndentEm when textAlign is center or right.
   * Saves to document-level layoutOverrides, preserving formatSource identity.
   */
  setHeadingLayout(
    level: import('./heading-types').HeadingLevel,
    config: import('./heading-types').HeadingLayoutConfig,
  ): void {
    const docKey = this.getDocumentKey()
    if (!docKey) return

    const store = this.scopeStore
    const structure = resolveHeadingStructure(this.s)
    const mode = structure.mode
    const existingLo = store.documentOverrides[docKey]?.layoutOverrides
    const currentByMode = existingLo?.headingLayoutsByMode
      ? { ...existingLo.headingLayoutsByMode }
      : {}
    const currentGap = existingLo?.numberTitleSpacing ? { ...existingLo.numberTitleSpacing } : {}

    // Auto-clear indent when center or right
    const effectiveConfig = config.textAlign !== 'left'
      ? { ...config, firstLineIndentEm: 0 }
      : { ...config }

    // Physical H1-H6 key — NO style-slot level shift.
    const levelKey = `h${level}`
    const modeLayouts = currentByMode[mode] ? { ...currentByMode[mode] } : {}
    modeLayouts[levelKey] = effectiveConfig
    currentByMode[mode] = modeLayouts

    const layoutOverrides: import('./heading-types').DocumentLayoutOverrides = {
      headingLayoutsByMode: currentByMode,
      numberTitleSpacing: currentGap,
    }

    const newStore = saveLayoutOverrides(this.scopeStore, docKey, layoutOverrides)
    this.persistScopeStore(newStore)

    // Immediately apply the effective layouts
    const effectiveLayouts = this.getEffectiveHeadingLayouts(mode)
    if (effectiveLayouts) {
      this.adapter.applyHeadingLayouts(effectiveLayouts)
    }
  }

  /** Copy layout from one level to all subsequent levels. */
  applyLayoutToSubsequentLevels(
    fromLevel: import('./heading-types').HeadingLevel,
  ): void {
    const docKey = this.getDocumentKey()
    if (!docKey) return

    const store = this.scopeStore
    const structure = resolveHeadingStructure(this.s)
    const mode = structure.mode
    const existingLo = store.documentOverrides[docKey]?.layoutOverrides
    const currentByMode = existingLo?.headingLayoutsByMode
      ? { ...existingLo.headingLayoutsByMode }
      : {}
    const currentGap = existingLo?.numberTitleSpacing ? { ...existingLo.numberTitleSpacing } : {}
    const modeLayouts = currentByMode[mode] ? { ...currentByMode[mode] } : {}
    const fromKey = `h${fromLevel}`
    const source = modeLayouts[fromKey] ?? { textAlign: 'left' as const, firstLineIndentEm: 0 }

    for (const lv of [fromLevel + 1, fromLevel + 2, fromLevel + 3, fromLevel + 4, fromLevel + 5, fromLevel + 6] as import('./heading-types').HeadingLevel[]) {
      if (lv > 6) break
      const key = `h${lv}`
      modeLayouts[key] = { ...source }
    }
    currentByMode[mode] = modeLayouts

    const layoutOverrides: import('./heading-types').DocumentLayoutOverrides = {
      headingLayoutsByMode: currentByMode,
      numberTitleSpacing: currentGap,
    }

    const newStore = saveLayoutOverrides(this.scopeStore, docKey, layoutOverrides)
    this.persistScopeStore(newStore)

    const effectiveLayouts = this.getEffectiveHeadingLayouts(mode)
    if (effectiveLayouts) {
      this.adapter.applyHeadingLayouts(effectiveLayouts)
    }
  }

  /** Reset all heading layouts to defaults (clear document layout overrides). */
  resetAllHeadingLayouts(): void {
    const docKey = this.getDocumentKey()
    if (!docKey) return

    const newStore = saveLayoutOverrides(this.scopeStore, docKey, undefined)
    this.persistScopeStore(newStore)

    // Immediately clear layouts from DOM
    this.adapter.clearHeadingLayouts()
  }

  /**
   * Reset layout overrides for the current document, restoring template defaults.
   * Does NOT affect formatSource — the format remains "applied".
   */
  resetLayoutOverrides(): void {
    const docKey = this.getDocumentKey()
    if (!docKey) return

    const newStore = saveLayoutOverrides(this.scopeStore, docKey, undefined)
    this.persistScopeStore(newStore)

    // Reload context so effective settings reflect cleared overrides
    this.docContext = resolveEffectiveSettings(this.scopeStore, docKey, this.getFormatLibrary())
    this.docContext.settingsRevision = this.settingsRevision
    this.adapter.clearHeadingLayouts()
  }

  /**
   * Save number-title spacing overrides to layoutOverrides.
   * Preserves existing headingLayouts and formatSource.
   */
  saveNumberTitleSpacingToLayout(
    gaps: Partial<Record<import('./heading-types').HeadingLevel, import('./heading-types').NumberTitleSpacing>>,
  ): void {
    const docKey = this.getDocumentKey()
    if (!docKey) return

    const store = this.scopeStore
    const existingLo = store.documentOverrides[docKey]?.layoutOverrides
    const layoutOverrides: import('./heading-types').DocumentLayoutOverrides = {
      headingLayouts: existingLo?.headingLayouts ? { ...existingLo.headingLayouts } : undefined,
      headingLayoutsByMode: existingLo?.headingLayoutsByMode ? { ...existingLo.headingLayoutsByMode } : undefined,
      numberTitleSpacing: { ...gaps },
    }

    const newStore = saveLayoutOverrides(this.scopeStore, docKey, layoutOverrides)
    this.persistScopeStore(newStore)
  }

  /**
   * Save complete layout overrides from the settings tab draft.
   * Persists to layoutOverrides and applies to DOM.
   * Preserves formatSource, formatId/presetId, and version.
   */
  saveLayoutOverridesFromDraft(
    docKey: string,
    layoutOverrides: import('./heading-types').DocumentLayoutOverrides,
  ): void {
    const newStore = saveLayoutOverrides(this.scopeStore, docKey, layoutOverrides)
    this.persistScopeStore(newStore)
    this.settingsRevision++

    // Reload document context so effective settings reflect new layout overrides
    const currentKey = this.getDocumentKey()
    if (currentKey === docKey) {
      this.docContext = resolveEffectiveSettings(this.scopeStore, currentKey, this.getFormatLibrary())
      this.docContext.settingsRevision = this.settingsRevision
      // Apply layouts to DOM immediately
      const effectiveLayouts = this.getEffectiveHeadingLayouts()
      if (effectiveLayouts) {
        this.adapter.applyHeadingLayouts(effectiveLayouts)
      }
    }
  }

  private defaultLayouts(): import('./heading-types').HeadingLayoutSettings {
    const def: import('./heading-types').HeadingLayoutConfig = {
      textAlign: 'left',
      firstLineIndentEm: 0,
    }
    return { h1: { ...def }, h2: { ...def }, h3: { ...def }, h4: { ...def }, h5: { ...def }, h6: { ...def } }
  }

  private logRefresh(reason: RefreshReason, headingCount: number, diff: { scanned: number; repaired: number; updated: number; removed: number }, startTime: number): void {
    if (!this.ctx.settings.get('debug')) return
    const duration = performance.now() - startTime
    logger.debug(
      `Heading refresh reason=${reason} headings=${headingCount} diff=s${diff.scanned}/r${diff.repaired}/u${diff.updated}/d${diff.removed} duration=${duration.toFixed(1)}ms`,
    )
  }

  // ── R58.5: Generic DOM Replacement Continuity ───────────────────

  /**
   * Detect CURRENT_LIVE bound elements removed in a MutationObserver batch.
   * Creates LiveReplacementTickets and attempts continuity resolution
   * using DOM evidence (same parent, same batch, single candidate).
   * Does NOT use anchor/text/ordinal heuristics.
   */
  private detectGenericDomReplacement(mutations: MutationRecord[]): void {
    // Collect all removed elements
    const removedElements: HTMLElement[] = []
    const addedElements: HTMLElement[] = []

    for (const m of mutations) {
      if (m.type !== 'childList') continue
      for (let i = 0; i < m.removedNodes.length; i++) {
        const node = m.removedNodes[i]
        if (node instanceof HTMLElement) removedElements.push(node)
      }
      for (let i = 0; i < m.addedNodes.length; i++) {
        const node = m.addedNodes[i]
        if (node instanceof HTMLElement) addedElements.push(node)
      }
    }

    // ── R58.6: EDITOR-MUTATION-BATCH ──
    const removedPs = removedElements.filter(el => el.tagName === 'P')
    const addedPs = addedElements.filter(el => el.tagName === 'P')
    const batchId = `emb-${Date.now()}-${Math.random().toString(36).slice(2, 4)}`
    const docKeyBatch = this.getDocumentKey() ?? ''
    const editorRoot = this.adapter.getEditorRoot()
    const selTruthBatch = resolveSelectionTruth(
      editorRoot ?? document.body,
      (el: object) => this.getParagraphRuntimeId(el as HTMLElement),
      'MUTATION',
    )
    const selRuntimeId = selTruthBatch.runtimeId ?? 'none'
    const scopeCtx = this.getScopeContext()
    emitRuntimeAudit('EDITOR-MUTATION-BATCH', {
      batchId,
      removedParagraphCount: removedPs.length,
      addedParagraphCount: addedPs.length,
      removedRuntimeIds: `[${removedPs.map(p => this.getParagraphRuntimeId(p)).join(',')}]`,
      addedRuntimeIds: `[${addedPs.map(p => this.getParagraphRuntimeId(p)).join(',')}]`,
      selectionRuntimeId: selRuntimeId,
      scopeId: scopeCtx.scopeId,
      persistenceKey: scopeCtx.persistenceKey ?? 'null',
      documentMode: scopeCtx.mode,
    })

    // ── R58.6.2: EDITOR-MUTATION-CLASSIFICATION from GLOBAL batch shape ──
    // Shape is determined by TOTAL removed/added paragraph counts, NOT canonical participants
    const globalShape = (() => {
      const r = removedPs.length, a = addedPs.length
      if (r === 0 && a === 0) return 'NONE' as const
      if (r === 1 && a === 1) return 'REPLACE_1_TO_1' as const
      if (r === 1 && a === 2) return 'SPLIT_1_TO_2' as const
      if (r === 2 && a === 1) return 'MERGE_2_TO_1' as const
      return 'COMPLEX' as const
    })()
    console.info(
      `[InkChapter] EDITOR-MUTATION-CLASSIFICATION: ` +
      `batchId=${batchId} ` +
      `mutationShape=${globalShape} ` +
      `removedParagraphCount=${removedPs.length} ` +
      `addedParagraphCount=${addedPs.length} ` +
      `canonicalRemovedCount=0 ` +
      `canonicalAddedCandidateCount=0 ` +
      `reason=global-batch-shape`,
    )

    // ── R58.7: NORMAL-ENTER-RAW-MUTATION — only when active NormalEnter txn owns this batch ──
    const ownerTxn = this.activeNormalEnterTxn
    if (ownerTxn?.active && ownerTxn.state === 'NATIVE_MUTATION_PENDING') {
      for (let mi = 0; mi < mutations.length; mi++) {
        const m = mutations[mi]
        const targetRtId = m.target instanceof HTMLElement
          ? this.getParagraphRuntimeId(m.target)
          : (m.target as Element).tagName ?? 'unknown'
        const addedSummaries: string[] = []
        const removedSummaries: string[] = []
        for (let ai = 0; ai < m.addedNodes.length; ai++) {
          const an = m.addedNodes[ai]
          addedSummaries.push(an instanceof HTMLElement ? `${an.tagName}#rt=${this.getParagraphRuntimeId(an)}` : an.nodeName)
        }
        for (let ri = 0; ri < m.removedNodes.length; ri++) {
          const rn = m.removedNodes[ri]
          removedSummaries.push(rn instanceof HTMLElement ? `${rn.tagName}#rt=${this.getParagraphRuntimeId(rn)}` : rn.nodeName)
        }
        console.info(
          `[InkChapter] NORMAL-ENTER-RAW-MUTATION: ` +
          `normalEnterTxnId=${ownerTxn.id} ` +
          `batchId=${batchId} ` +
          `index=${mi + 1}/${mutations.length} ` +
          `type=${m.type} ` +
          `targetTag=${(m.target as Element).tagName ?? 'unknown'} ` +
          `targetRuntimeId=${targetRtId} ` +
          `added=[${addedSummaries.join(',')}] ` +
          `removed=[${removedSummaries.join(',')}] ` +
          `addedCount=${m.addedNodes.length} ` +
          `removedCount=${m.removedNodes.length} ` +
          `mutationShape=${globalShape}`,
        )
      }
    }

    // ── R58.7 Phase A: Gate — no business mutations without document context ──
    if (!this.assertDocumentContextReady('mutation-observer')) return

    // ── PF4: Capture + clear single-slot boundary merge intent (armed at keydown) ──
    const boundaryIntent = this.pendingBoundaryMergeIntent
    this.pendingBoundaryMergeIntent = null
    let boundaryMergeConsumed = false

    // ── R58.6.7: MERGE_2_TO_1 — BATCH-FIRST PREFLIGHT (MUST precede per-owner loop) ──
    // Collect owners BEFORE any markAwaitingTransfer / canonicalTransferBinding.
    // M3 (canonicalOwnerCount >= 2) → BLOCK_MULTI_OWNER with ZERO partial commit.
    if (globalShape === 'MERGE_2_TO_1') {
      this.handleMerge2To1BatchFirst(removedPs, addedPs, batchId, docKeyBatch, selRuntimeId)
    } else if (boundaryIntent && removedPs.length === 1 && addedPs.length === 0) {
      // ── PF4: 1→0 existing-survivor boundary merge (continuity sub-classification) ──
      this.handleBoundaryMergeExistingSurvivor(boundaryIntent, removedPs, batchId, docKeyBatch, selRuntimeId)
      boundaryMergeConsumed = true
    }

    // Per-owner loop for non-MERGE shapes (REPLACE_1_TO_1, SPLIT_1_TO_2, COMPLEX).
    // Skip P elements when MERGE_2_TO_1 or a 1→0 boundary merge (already handled).
    let canonicalRemovedCount = 0
    let canonicalAddedCandidateCount = 0
    for (const removedEl of removedElements) {
      // R58.6.7: P elements in MERGE_2_TO_1 already handled by batch-first preflight
      if (globalShape === 'MERGE_2_TO_1' && removedEl.tagName === 'P') continue
      // PF4: P element consumed by 1→0 boundary merge preflight
      if (boundaryMergeConsumed && removedEl.tagName === 'P') continue

      // R58.6: Use resolveRecordByRemovedElement — removed elements ARE disconnected
      const exactRecord = this.canonicalRegistry.resolveRecordByRemovedElement(removedEl)
      if (!exactRecord) continue

      const docKey = this.getDocumentKey() ?? ''
      if (exactRecord.meta.documentKey !== docKey) continue

      // Don't interfere with active One-Shot Handoff
      if (this.activeOneShotHandoff && !this.activeOneShotHandoff.consumed) {
        if (this.activeOneShotHandoff.preElement === removedEl) {
          // Handoff will handle this
          continue
        }
      }

      // Create LiveReplacementTicket
      const ticketId = `lrt-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`
      const parentEl = removedEl.parentElement
      const parent = removedEl.parentElement

      // Find child index within parent
      let childIdx: number | undefined
      if (parent) {
        for (let i = 0; i < parent.children.length; i++) {
          if (parent.children[i] === removedEl) { childIdx = i; break }
        }
      }

      const ticket: LiveReplacementTicket = {
        ticketId,
        recordId: exactRecord.recordId,
        documentKey: docKey,
        scopeId: this.documentContext.scopeId ?? 'unknown',
        previousElement: removedEl,
        previousRuntimeId: exactRecord.meta.currentRuntimeId ?? 'unknown',
        previousGeneration: exactRecord.meta.generation,
        parentElement: parentEl ?? undefined,
        childIndex: childIdx,
        semanticMode: exactRecord.record?.mode ?? 'force-indent',
        createdAt: Date.now(),
        source: 'MUTATION_OBSERVER',
      }

      this.activeLiveReplacementTickets.set(ticketId, ticket)
      canonicalRemovedCount++

      emitRuntimeAudit('LIVE-REPLACEMENT-TICKET', {
        ticketId,
        recordId: ticket.recordId,
        fromRuntimeId: ticket.previousRuntimeId,
        generation: ticket.previousGeneration,
        scopeId: this.documentContext.scopeId ?? 'unknown',
        persistenceKey: this.documentContext.persistenceKey ?? 'null',
        mode: this.documentContext.mode,
        source: 'MUTATION_OBSERVER',
      })

      // ── R58.7: SOURCE-SNAPSHOT captured BEFORE markAwaitingTransfer (state MUST be CURRENT_LIVE) ──
      emitRuntimeAudit('SOURCE-SNAPSHOT', {
        recordId: ticket.recordId,
        recordMode: ticket.semanticMode,
        scopeId: ticket.scopeId,
        persistenceKey: exactRecord.meta.persistenceKey ?? 'null',
        generation: ticket.previousGeneration,
        fromRuntimeId: ticket.previousRuntimeId,
        state: exactRecord.meta.state,
      })

      // Mark as awaiting transfer
      this.canonicalRegistry.markAwaitingTransfer(
        exactRecord.recordId, ticketId, 'generic-dom-replacement',
        ticket.scopeId,
      )

      // ── R58.6.2: Resolve based on authoritative global shape ──
      // NOTE: MERGE_2_TO_1 is handled by batch-first preflight above, not here.
      if (globalShape === 'COMPLEX') {
        logger.info(`LIVE-REPLACEMENT-BLOCK: ticketId=${ticketId} recordId=${ticket.recordId} mutationShape=COMPLEX reason=unsafe-shape`)
        continue
      }

      if (globalShape === 'SPLIT_1_TO_2') {
        // R58.6.2: SPLIT resolver — separate canonicalOwner from caretDestination
        this.resolveSplitContinuity(ticket, exactRecord, addedPs, batchId, removedEl)
        canonicalAddedCandidateCount += 2
        continue
      }

      // REPLACE_1_TO_1: only allowed shape for 1→1 resolver
      const addedPsFiltered = addedElements.filter(el =>
        el.tagName === 'P' && el.isConnected &&
        el !== removedEl,
      )

      const resolution = this.canonicalRegistry.resolveLiveReplacement(
        ticket, removedElements, addedPsFiltered, parentEl,
      )

      if (resolution.decision === 'TRANSFER') {
        canonicalAddedCandidateCount++
        const newRuntimeId = this.getParagraphRuntimeId(resolution.replacement)

        console.info(
          `[InkChapter] LIVE-REPLACEMENT-DETECTED: ` +
          `ticketId=${ticketId} ` +
          `same-batch same-parent candidateCount=1`,
        )

        const docKey2 = this.getDocumentKey() ?? ''
        const transferResult = this.canonicalTransferBinding(
          ticket.recordId,
          removedEl, ticket.previousRuntimeId,
          resolution.replacement, newRuntimeId,
          'LIVE_DOM_REPLACEMENT',
          ticketId,
          ticket.scopeId,
        )

        if (transferResult.success) {
          console.info(
            `[InkChapter] EDITOR-CONTINUITY-RESOLVE: ` +
            `mutationShape=REPLACE_1_TO_1 ` +
            `recordId=${ticket.recordId} ` +
            `fromRuntimeId=${ticket.previousRuntimeId} ` +
            `toRuntimeId=${newRuntimeId} ` +
            `decision=RESOLVED`,
          )
          this.activeLiveReplacementTickets.delete(ticketId)
        } else {
          console.info(
            `[InkChapter] LIVE-REPLACEMENT-BLOCK: ` +
            `ticketId=${ticketId} ` +
            `recordId=${ticket.recordId} ` +
            `reason=${transferResult.failReason ?? 'transfer-failed'} ` +
            `candidateCount=1`,
          )
        }
      } else if (resolution.decision === 'PENDING') {
        console.info(
          `[InkChapter] LIVE-REPLACEMENT-MISSED: ` +
          `ticketId=${ticketId} ` +
          `recordId=${ticket.recordId} ` +
          `reason=${resolution.reason} ` +
          `candidateCount=${resolution.candidateCount} ` +
          `addedParagraphCount=${addedPsFiltered.length}`,
        )
      }
    }

    // Update batch-level classification with canonical counts
    console.info(
      `[InkChapter] EDITOR-MUTATION-CLASSIFICATION: ` +
      `batchId=${batchId} ` +
      `mutationShape=${globalShape} ` +
      `removedParagraphCount=${removedPs.length} ` +
      `addedParagraphCount=${addedPs.length} ` +
      `canonicalRemovedCount=${canonicalRemovedCount} ` +
      `canonicalAddedCandidateCount=${canonicalAddedCandidateCount} ` +
      `reason=global-batch-shape-final`,
    )
  }

  /**
   * R58.6.2: Resolve SPLIT_1_TO_2 continuity.
   *
   * Separates canonicalOwner (completed old paragraph) from caretDestination
   * (new paragraph with caret). Uses selection + DOM continuity evidence.
   */
  private resolveSplitContinuity(
    ticket: LiveReplacementTicket,
    exactRecord: { recordId: string; meta: CanonicalRuntimeMeta; record: ParagraphIndentOverrideRecord | undefined },
    addedPs: HTMLElement[],
    batchId: string,
    removedEl: HTMLElement,
  ): void {
    // Require exactly 2 added paragraphs for split
    if (addedPs.length !== 2) {
      console.info(
        `[InkChapter] LIVE-REPLACEMENT-BLOCK: ` +
        `ticketId=${ticket.ticketId} ` +
        `recordId=${ticket.recordId} ` +
        `mutationShape=SPLIT_1_TO_2 ` +
        `reason=expected-2-added-got-${addedPs.length}`,
      )
      return
    }

    // Resolve caret destination from selection
    const root = this.adapter.getEditorRoot()
    if (!root) return

    const splitSelTruth = resolveSelectionTruth(
      root,
      (el: object) => this.getParagraphRuntimeId(el as HTMLElement),
      'SPLIT',
    )
    const selRuntimeId = splitSelTruth.runtimeId

    let caretDestination: HTMLElement | null = null
    let caretDestinationIdx = -1

    if (selRuntimeId) {
      for (let i = 0; i < addedPs.length; i++) {
        if (this.getParagraphRuntimeId(addedPs[i]) === selRuntimeId) {
          caretDestination = addedPs[i]
          caretDestinationIdx = i
          break
        }
      }
    }

    if (!caretDestination) {
      console.info(
        `[InkChapter] LIVE-REPLACEMENT-BLOCK: ` +
        `ticketId=${ticket.ticketId} ` +
        `recordId=${ticket.recordId} ` +
        `mutationShape=SPLIT_1_TO_2 ` +
        `reason=caret-destination-not-in-added-paragraphs ` +
        `selectionRuntimeId=${selRuntimeId ?? 'none'}`,
      )
      return
    }

    console.info(
      `[InkChapter] SPLIT-CARET-DESTINATION: ` +
      `ticketId=${ticket.ticketId} ` +
      `caretDestinationRuntimeId=${this.getParagraphRuntimeId(caretDestination)} ` +
      `selectionRuntimeId=${selRuntimeId} ` +
      `decision=RESOLVED`,
    )

    // Canonical owner = the OTHER added paragraph (not caret destination)
    const canonicalOwner = addedPs[1 - caretDestinationIdx]
    if (!canonicalOwner || !canonicalOwner.isConnected) {
      console.info(
        `[InkChapter] LIVE-REPLACEMENT-BLOCK: ` +
        `ticketId=${ticket.ticketId} ` +
        `mutationShape=SPLIT_1_TO_2 ` +
        `reason=canonical-owner-not-valid`,
      )
      return
    }

    const canonicalOwnerRtId = this.getParagraphRuntimeId(canonicalOwner)

    console.info(
      `[InkChapter] EDITOR-CONTINUITY-RESOLVE: ` +
      `ticketId=${ticket.ticketId} ` +
      `mutationShape=SPLIT_1_TO_2 ` +
      `recordId=${ticket.recordId} ` +
      `fromRuntimeId=${ticket.previousRuntimeId} ` +
      `canonicalOwnerRuntimeId=${canonicalOwnerRtId} ` +
      `caretDestinationRuntimeId=${selRuntimeId} ` +
      `decision=RESOLVED`,
    )

    // Transfer canonical binding to canonical owner
    const docKey2 = this.getDocumentKey() ?? ''
    const transferResult = this.canonicalTransferBinding(
      ticket.recordId,
      removedEl, ticket.previousRuntimeId,
      canonicalOwner, canonicalOwnerRtId,
      'LIVE_DOM_SPLIT_COMPLETED_PARAGRAPH',
      ticket.ticketId,
      ticket.scopeId,
    )

    if (transferResult.success) {
      console.info(
        `[InkChapter] CANONICAL-BINDING-TRANSFER: ` +
        `recordId=${ticket.recordId} ` +
        `fromRuntimeId=${ticket.previousRuntimeId} ` +
        `toRuntimeId=${canonicalOwnerRtId} ` +
        `reason=LIVE_DOM_SPLIT_COMPLETED_PARAGRAPH ` +
        `mutationShape=SPLIT_1_TO_2`,
      )
      this.activeLiveReplacementTickets.delete(ticket.ticketId)

      // ── R58.6.7: CaretExpectation for split — target = caretDestination, NOT canonicalOwner ──
      const caretDestRtId = this.getParagraphRuntimeId(caretDestination)
      this.activeCaretExpectation = {
        expectationId: `ce-split-${ticket.ticketId}`,
        documentKey: docKey2,
        scopeId: this.documentContext.scopeId ?? 'unknown',
        expectedElement: caretDestination,
        expectedRuntimeId: caretDestRtId,
        expectedLogicalOffset: 0,
        canonicalRecordId: ticket.recordId,
        generation: transferResult.generationAfter,
        reason: 'SPLIT_NEW_PARAGRAPH',
        createdAt: Date.now(),
        active: true,
        restoreAttempts: 0,
        intentEpoch: this.userIntentEpoch,
        expectedTextContent: getUserVisibleParagraphText(caretDestination),
      }
      console.info(
        `[InkChapter] CARET-EXPECTATION-CREATE: ` +
        `expectationId=${this.activeCaretExpectation.expectationId} ` +
        `scopeId=${this.activeCaretExpectation.scopeId} ` +
        `reason=SPLIT_NEW_PARAGRAPH ` +
        `intentEpoch=${this.userIntentEpoch} ` +
        `expectedRuntimeId=${caretDestRtId} ` +
        `expectedLogicalOffset=0 ` +
        `canonicalOwnerRuntimeId=${canonicalOwnerRtId} ` +
        `decision=ACTIVE`,
      )
    }
  }

  /**
   * PF4: Arm a single-slot boundary merge intent at keydown, BEFORE Typora's
   * native DOM mutation. Only arms on a genuine ordinary-body paragraph
   * boundary (Delete at end / Backspace at start with a mergeable neighbor).
   */
  private armBoundaryMergeIntent(key: 'Delete' | 'Backspace'): boolean {
    if (!this.assertDocumentContextReady('boundary-merge-arm')) return false
    const root = this.adapter.getEditorRoot()
    if (!root) return false

    const sel = window.getSelection()
    if (!sel || !sel.isCollapsed) return false

    const current = resolveCurrentBodyParagraph(root)
    if (!current) return false

    const allParas = collectContentParagraphs(root)
    const idx = allParas.indexOf(current)
    if (idx < 0) return false

    let left: HTMLElement
    let right: HTMLElement
    if (key === 'Delete') {
      if (!isCursorAtEnd()) return false
      const next = allParas[idx + 1]
      if (!next) return false
      left = current
      right = next
    } else {
      if (!isCaretAtLogicalStartOfParagraph(current)) return false
      const prev = allParas[idx - 1]
      if (!prev) return false
      left = prev
      right = current
    }

    const leftText = getUserVisibleParagraphText(left)
    const rightText = getUserVisibleParagraphText(right)
    const leftRecord = this.canonicalRegistry.resolveExactLiveRecord(left)
    const rightRecord = this.canonicalRegistry.resolveExactLiveRecord(right)
    const leftSemantic = getParagraphIndentMode(left)
    const rightSemantic = getParagraphIndentMode(right)
    const leftRecordId = leftRecord?.recordId ?? null
    const rightRecordId = rightRecord?.recordId ?? null
    const leftExplicitProven = leftSemantic !== 'auto' && leftRecordId != null
    const rightExplicitProven = rightSemantic !== 'auto' && rightRecordId != null
    const leftOwnershipProofReason = leftRecordId
      ? 'CURRENT_LIVE_CANONICAL_OWNER'
      : leftSemantic !== 'auto' ? 'UNPROVEN_EXPLICIT_SEMANTIC' : 'AUTO'
    const rightOwnershipProofReason = rightRecordId
      ? 'CURRENT_LIVE_CANONICAL_OWNER'
      : rightSemantic !== 'auto' ? 'UNPROVEN_EXPLICIT_SEMANTIC' : 'AUTO'

    this.pendingBoundaryMergeIntent = {
      intentId: `bmi-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      intentEpoch: this.userIntentEpoch,
      key,
      direction: key === 'Delete' ? 'forward' : 'backward',
      leftElement: left,
      rightElement: right,
      leftRuntimeId: this.getParagraphRuntimeId(left),
      rightRuntimeId: this.getParagraphRuntimeId(right),
      leftText,
      rightText,
      leftSemantic,
      rightSemantic,
      leftRecordId,
      rightRecordId,
      leftExplicitProven,
      rightExplicitProven,
      leftOwnershipProofReason,
      rightOwnershipProofReason,
      expectedMergedText: leftText + rightText,
      expectedCaretOffset: leftText.length,
      documentKey: this.getDocumentKey() ?? '',
      scopeId: this.documentContext.scopeId ?? 'unknown',
    }

    // ── PF5: contamination observability — force-* semantic without owner ──
    if (leftSemantic !== 'auto' && leftRecordId == null) {
      emitRuntimeAudit('PARAGRAPH-SEMANTIC-OWNER-MISMATCH', {
        runtimeId: this.getParagraphRuntimeId(left),
        semantic: leftSemantic,
        recordId: 'none',
        ownershipProof: false,
        source: 'BOUNDARY-MERGE-ARM',
        decision: 'UNPROVEN_EXPLICIT_SEMANTIC',
      })
    }
    if (rightSemantic !== 'auto' && rightRecordId == null) {
      emitRuntimeAudit('PARAGRAPH-SEMANTIC-OWNER-MISMATCH', {
        runtimeId: this.getParagraphRuntimeId(right),
        semantic: rightSemantic,
        recordId: 'none',
        ownershipProof: false,
        source: 'BOUNDARY-MERGE-ARM',
        decision: 'UNPROVEN_EXPLICIT_SEMANTIC',
      })
    }

    emitRuntimeAudit('BOUNDARY-MERGE-INTENT-ARM', {
      intentEpoch: this.userIntentEpoch,
      key,
      leftRuntimeId: this.getParagraphRuntimeId(left),
      rightRuntimeId: this.getParagraphRuntimeId(right),
      leftText,
      rightText,
      leftSemantic,
      rightSemantic,
      leftRecordId: leftRecordId ?? 'none',
      rightRecordId: rightRecordId ?? 'none',
      leftExplicitProven,
      rightExplicitProven,
      leftOwnershipProofReason,
      rightOwnershipProofReason,
      expectedMergedText: leftText + rightText,
      expectedCaretOffset: leftText.length,
    })
    return true
  }

  /**
   * R58.6.7: Batch-first MERGE_2_TO_1 preflight.
   *
   * Collect ALL canonical owners from removed paragraphs BEFORE any lifecycle mutation.
   * M0 (ownerCount=0) → NO_CANONICAL_OWNER, zero mutations.
   * M1/M2 (ownerCount=1) → TRANSFER_SINGLE_OWNER, one awaiting→transfer→live.
   * M3 (ownerCount>=2) → BLOCK_MULTI_OWNER, ZERO partial commit.
   */
  private handleMerge2To1BatchFirst(
    removedPs: HTMLElement[],
    addedPs: HTMLElement[],
    batchId: string,
    docKey: string,
    selRuntimeId: string,
  ): void {
    // 1. Collect unique canonical owners
    const owners: MergeOwnerSnapshot[] = []
    const ownerRecordIds = new Set<string>()

    for (const removedP of removedPs) {
      const exactRecord = this.canonicalRegistry.resolveRecordByRemovedElement(removedP)
      if (!exactRecord) continue
      if (exactRecord.meta.documentKey !== docKey) continue

      // Don't interfere with active One-Shot Handoff
      if (this.activeOneShotHandoff && !this.activeOneShotHandoff.consumed) {
        if (this.activeOneShotHandoff.preElement === removedP) continue
      }

      if (ownerRecordIds.has(exactRecord.recordId)) continue // dedup unique recordIds

      ownerRecordIds.add(exactRecord.recordId)
      owners.push({
        recordId: exactRecord.recordId,
        runtimeId: exactRecord.meta.currentRuntimeId ?? 'unknown',
        generation: exactRecord.meta.generation,
        element: removedP,
        state: exactRecord.meta.state,
        documentKey: docKey,
        semantic: exactRecord.record?.mode ?? 'auto',
      })
    }

    const canonicalOwnerCount = owners.length
    const removedParagraphCount = removedPs.length

    // 2. MERGE-OWNER-COUNT-INVARIANT
    const invariantValid = canonicalOwnerCount <= removedParagraphCount
    console.info(
      `[InkChapter] MERGE-OWNER-COUNT-INVARIANT: ` +
      `batchId=${batchId} ` +
      `removedParagraphCount=${removedParagraphCount} ` +
      `canonicalOwnerCount=${canonicalOwnerCount} ` +
      `valid=${invariantValid}`,
    )

    // 3. MERGE-BATCH-PREFLIGHT — resolve semantic winner BEFORE any mutation
    const ownerIds = owners.map(o => o.recordId)
    const mergedDestination = addedPs.length === 1 ? addedPs[0] : null

    // ── PF3: content preservation snapshot ──────────────────────────
    // Removed paragraphs retain their frozen pre-merge textContent, so this is
    // the authoritative leftText/rightText WITHOUT intercepting native input.
    const leftText = removedPs[0]?.textContent ?? ''
    const rightText = removedPs[1]?.textContent ?? ''
    const contentExpectation = computeMergeContentExpectation(leftText, rightText)
    const mergeKey = this.lastUserIntentKey === 'Backspace' ? 'Backspace' : 'Delete'
    const mergeDirection = this.lastUserIntentKey === 'Backspace' ? 'backward' : 'forward'
    const leftRuntimeId = removedPs[0] ? this.getParagraphRuntimeId(removedPs[0]) : 'none'
    const rightRuntimeId = removedPs[1] ? this.getParagraphRuntimeId(removedPs[1]) : 'none'

    emitRuntimeAudit('PARAGRAPH-MERGE-INTENT', {
      batchId,
      intentEpoch: this.userIntentEpoch,
      key: mergeKey,
      direction: mergeDirection,
      leftRuntimeId,
      rightRuntimeId,
      leftText,
      rightText,
      expectedMergedText: contentExpectation.expectedMergedText,
      expectedCaretOffset: contentExpectation.expectedCaretOffset,
      scopeId: this.documentContext.scopeId ?? 'unknown',
      persistenceKey: this.documentContext.persistenceKey ?? 'null',
      documentKey: docKey,
    })

    // Phase 1 — content verify immediately after native merge (read-only).
    const nativeMergedText = mergedDestination?.textContent ?? ''
    const nativeVerify = verifyMergeContent(
      contentExpectation.expectedMergedText,
      nativeMergedText,
      contentExpectation.expectedCaretOffset,
    )
    emitRuntimeAudit('PARAGRAPH-MERGE-CONTENT-VERIFY', {
      batchId,
      phase: 'AFTER_NATIVE_MERGE',
      expectedMergedText: nativeVerify.expectedMergedText,
      actualMergedText: nativeVerify.actualMergedText,
      expectedCaretOffset: nativeVerify.expectedCaretOffset,
      reason: nativeVerify.reason,
      overall: nativeVerify.preserved,
    })

    // PF3: semantic merge resolution — explicit > auto; conflict by user intent.
    let winnerOwner: MergeOwnerSnapshot | null = null
    let loserOwner: MergeOwnerSnapshot | null = null
    let mergeResolutionReason = 'NO_CANONICAL_OWNER'

    if (canonicalOwnerCount === 1) {
      winnerOwner = owners[0]
      mergeResolutionReason = 'SINGLE_OWNER'
    } else if (canonicalOwnerCount >= 2) {
      // owners[] follows removedNodes order (left → right).
      const intent: 'delete' | 'backspace' = this.lastUserIntentKey === 'Backspace' ? 'backspace' : 'delete'
      const left = owners[0]
      const right = owners[1]
      const result = resolveMergeSemantic(intent, left.semantic, right.semantic)
      if (result.winner === left.semantic) {
        winnerOwner = left
        loserOwner = right
      } else {
        winnerOwner = right
        loserOwner = left
      }
      mergeResolutionReason = result.reason
    }

    console.info(
      `[InkChapter] MERGE-BATCH-PREFLIGHT: ` +
      `batchId=${batchId} ` +
      `mutationShape=MERGE_2_TO_1 ` +
      `removedRuntimeIds=[${removedPs.map(p => this.getParagraphRuntimeId(p)).join(',')}] ` +
      `mergedDestination=${mergedDestination ? this.getParagraphRuntimeId(mergedDestination) : 'none'} ` +
      `canonicalOwnerIds=[${ownerIds.join(',')}] ` +
      `canonicalOwnerCount=${canonicalOwnerCount} ` +
      `winnerRecordId=${winnerOwner ? winnerOwner.recordId : 'none'} ` +
      `loserRecordId=${loserOwner ? loserOwner.recordId : 'none'} ` +
      `mergeReason=${mergeResolutionReason}`,
    )

    // 4. Retire loser (if any) BEFORE transferring winner — exactly one owner.
    if (loserOwner) {
      this.canonicalRegistry.retireRecord(
        loserOwner.recordId,
        'merge-superseded',
        'EXPLICIT_PARAGRAPH_DELETE',
        this.documentContext.scopeId ?? 'unknown',
      )
      emitRuntimeAudit('PARAGRAPH-MERGE-CANONICAL-TRANSFER', {
        batchId,
        loserRecordId: loserOwner.recordId,
        winnerRecordId: winnerOwner!.recordId,
        decision: 'RETIRE_LOSER',
        mergeReason: mergeResolutionReason,
      })
    }

    if (!winnerOwner) {
      console.info(
        `[InkChapter] MERGE-BATCH-PREFLIGHT: ` +
        `batchId=${batchId} ` +
        `canonicalOwnerCount=0 ` +
        `decision=NO_CANONICAL_OWNER ` +
        `markAwaitingTransfer=0 ` +
        `canonicalTransferBinding=0`,
      )
      return
    }

    // ── Transfer winner owner to merged destination ──
    if (!mergedDestination || !mergedDestination.isConnected) {
      logger.info(`MERGE-CONTINUITY-RESOLVE: batchId=${batchId} decision=BLOCK_AMBIGUOUS reason=destination-disconnected`)
      return
    }

    const owner = winnerOwner
    const ticketId = `lrt-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`
    const toRtId = this.getParagraphRuntimeId(mergedDestination)
    const fromRtId = this.getParagraphRuntimeId(owner.element)

    // Create ticket for tracking
    const ticket: LiveReplacementTicket = {
      ticketId,
      recordId: owner.recordId,
      documentKey: docKey,
      scopeId: this.documentContext.scopeId ?? 'unknown',
      previousElement: owner.element,
      previousRuntimeId: owner.runtimeId,
      previousGeneration: owner.generation,
      parentElement: owner.element.parentElement ?? undefined,
      semanticMode: owner.semantic,
      createdAt: Date.now(),
      source: 'MUTATION_OBSERVER',
    }
    this.activeLiveReplacementTickets.set(ticketId, ticket)

    emitRuntimeAudit('LIVE-REPLACEMENT-TICKET', {
      ticketId,
      recordId: ticket.recordId,
      fromRuntimeId: ticket.previousRuntimeId,
      generation: ticket.previousGeneration,
      scopeId: this.documentContext.scopeId ?? 'unknown',
      persistenceKey: this.documentContext.persistenceKey ?? 'null',
      mode: this.documentContext.mode,
      source: 'MUTATION_OBSERVER',
    })

    console.info(
      `[InkChapter] MERGE-CONTINUITY-TICKET: ` +
      `ticketId=${ticketId} ` +
      `documentKey=${docKey} ` +
      `removedRuntimeIds=[${fromRtId}] ` +
      `canonicalRemovedRecords=[{recordId=${owner.recordId},runtimeId=${owner.runtimeId},generation=${owner.generation}}] ` +
      `mergedDestination=${toRtId} ` +
      `createdAt=${Date.now()}`,
    )

    // Mark awaiting → transfer → live in one atomic sequence
    this.canonicalRegistry.markAwaitingTransfer(
      owner.recordId, ticketId, 'generic-dom-replacement',
      ticket.scopeId,
    )

    const transferResult = this.canonicalTransferBinding(
      owner.recordId,
      owner.element, owner.runtimeId,
      mergedDestination, toRtId,
      'LIVE_DOM_MERGE_SINGLE_OWNER',
      ticketId,
      ticket.scopeId,
    )

    if (transferResult.success) {
      console.info(
        `[InkChapter] MERGE-CONTINUITY-RESOLVE: ` +
        `ticketId=${ticketId} ` +
        `decision=TRANSFER_SINGLE_OWNER ` +
        `recordId=${owner.recordId} ` +
        `fromRuntimeId=${owner.runtimeId} ` +
        `toRuntimeId=${toRtId} ` +
        `generationBefore=${transferResult.generationBefore} ` +
        `generationAfter=${transferResult.generationAfter} ` +
        `recordCount unchanged`,
      )
      this.activeLiveReplacementTickets.delete(ticketId)

      // ── PF3: Phase 2 — content verify after canonical transfer (read-only) ──
      const postTransferText = mergedDestination?.textContent ?? ''
      const postTransferVerify = verifyMergeContent(
        contentExpectation.expectedMergedText,
        postTransferText,
        contentExpectation.expectedCaretOffset,
      )
      emitRuntimeAudit('PARAGRAPH-MERGE-CONTENT-VERIFY', {
        batchId,
        phase: 'AFTER_CANONICAL_TRANSFER',
        expectedMergedText: postTransferVerify.expectedMergedText,
        actualMergedText: postTransferVerify.actualMergedText,
        expectedCaretOffset: postTransferVerify.expectedCaretOffset,
        reason: postTransferVerify.reason,
        overall: postTransferVerify.preserved,
      })

      // ── PF3: caret verify (read-only; never writes selection) ──
      const root = this.adapter.getEditorRoot()
      const mergeSel = window.getSelection()
      const caretVerifyRes = root
        ? resolveSelectionParagraph(
            mergeSel, root,
            (el: object) => this.getParagraphRuntimeId(el as HTMLElement),
          )
        : null
      const caretCollapsed = mergeSel?.isCollapsed ?? false
      const caretRuntimeId = caretVerifyRes?.paragraphRuntimeId ?? 'none'
      const caretOffset = caretVerifyRes?.localLogicalOffset ?? -1
      emitRuntimeAudit('PARAGRAPH-MERGE-CARET-VERIFY', {
        batchId,
        selectionCollapsed: caretCollapsed,
        caretRuntimeId,
        expectedCaretOffset: contentExpectation.expectedCaretOffset,
        actualCaretOffset: caretOffset,
        caretOnSurvivor: caretRuntimeId === toRtId,
        caretOffsetCorrect: caretOffset === contentExpectation.expectedCaretOffset,
        overall: caretCollapsed && caretRuntimeId === toRtId && caretOffset === contentExpectation.expectedCaretOffset,
      })

      // ── PF3: final merge audit ──
      emitRuntimeAudit('PARAGRAPH-MERGE-FINAL', {
        batchId,
        key: mergeKey,
        direction: mergeDirection,
        leftRuntimeId,
        rightRuntimeId,
        survivorRuntimeId: toRtId,
        leftText,
        rightText,
        expectedMergedText: contentExpectation.expectedMergedText,
        actualMergedText: postTransferText,
        contentPreserved: postTransferVerify.preserved,
        semanticWinner: owner.semantic,
        winnerRecordId: owner.recordId,
        loserRecordId: loserOwner ? loserOwner.recordId : 'none',
        mergeReason: mergeResolutionReason,
        recordCountBefore: canonicalOwnerCount,
        awaitingCount: this.canonicalRegistry.getAwaitingCount(),
        overall: postTransferVerify.preserved,
      })

      // Check selection for caret destination
      if (caretVerifyRes?.paragraphRuntimeId === toRtId) {
        console.info(
          `[InkChapter] MERGE-CARET-DESTINATION: ` +
          `ticketId=${ticketId} ` +
          `runtimeId=${toRtId} ` +
          `decision=RESOLVED`,
        )
      }

      // ── R58.6.7: CaretExpectation for merge — target = mergedDestination ──
      this.activeCaretExpectation = {
        expectationId: `ce-merge-${ticketId}`,
        documentKey: docKey,
        scopeId: this.documentContext.scopeId ?? 'unknown',
        expectedElement: mergedDestination,
        expectedRuntimeId: toRtId,
        expectedLogicalOffset: contentExpectation.expectedCaretOffset,
        canonicalRecordId: owner.recordId,
        generation: transferResult.generationAfter,
        reason: 'MERGE_DESTINATION',
        createdAt: Date.now(),
        active: true,
        restoreAttempts: 0,
        intentEpoch: this.userIntentEpoch,
      }
      console.info(
        `[InkChapter] CARET-EXPECTATION-CREATE: ` +
        `expectationId=ce-merge-${ticketId} ` +
        `scopeId=${this.documentContext.scopeId ?? 'unknown'} ` +
        `reason=MERGE_DESTINATION ` +
        `intentEpoch=${this.userIntentEpoch} ` +
        `expectedRuntimeId=${toRtId} ` +
        `expectedLogicalOffset=${contentExpectation.expectedCaretOffset} ` +
        `decision=ACTIVE`,
      )
    } else {
      console.info(
        `[InkChapter] MERGE-CONTINUITY-RESOLVE: ` +
        `ticketId=${ticketId} ` +
        `decision=BLOCK_AMBIGUOUS ` +
        `reason=${transferResult.failReason ?? 'transfer-failed'}`,
      )
    }
  }

  /**
   * PF4: Boundary merge with an EXISTING survivor (1 removed / 0 added).
   *
   * Typora keeps one original <p> as the physical survivor and removes the
   * other. Canonical ownership must follow the semantic winner, NOT the DOM
   * survivor. Resolved synchronously within the same mutation batch.
   */
  private handleBoundaryMergeExistingSurvivor(
    intent: PendingBoundaryMergeIntent,
    removedPs: HTMLElement[],
    batchId: string,
    docKey: string,
    selRuntimeId: string,
  ): void {
    const leftConnected = intent.leftElement.isConnected
    const rightConnected = intent.rightElement.isConnected

    let survivor: HTMLElement | null = null
    let removedEl: HTMLElement | null = null

    if (leftConnected && !rightConnected) {
      survivor = intent.leftElement
      removedEl = intent.rightElement
    } else if (!leftConnected && rightConnected) {
      survivor = intent.rightElement
      removedEl = intent.leftElement
    }

    const survivorRuntimeId = survivor ? this.getParagraphRuntimeId(survivor) : 'none'

    emitRuntimeAudit('BOUNDARY-MERGE-MUTATION-RESOLVE', {
      batchId,
      globalMutationShape: 'COMPLEX',
      mergeVariant: survivor ? 'EXISTING_SURVIVOR_1_TO_0' : 'BLOCK_AMBIGUOUS',
      removedRuntimeIds: `[${removedPs.map(p => this.getParagraphRuntimeId(p)).join(',')}]`,
      addedRuntimeIds: '[]',
      leftConnectedAfter: leftConnected,
      rightConnectedAfter: rightConnected,
      survivorRuntimeId,
      decision: survivor ? 'RESOLVED' : 'BLOCK_AMBIGUOUS',
    })

    if (!survivor || !removedEl) return

    // Semantic resolution — reuse the shared 2→1 resolver.
    const semanticIntent: 'delete' | 'backspace' = intent.key === 'Backspace' ? 'backspace' : 'delete'
    const leftProvenSemantic = resolveProvenMergeSemantic(intent.leftSemantic, intent.leftRecordId)
    const rightProvenSemantic = resolveProvenMergeSemantic(intent.rightSemantic, intent.rightRecordId)
    const result = resolveMergeSemantic(semanticIntent, leftProvenSemantic, rightProvenSemantic)

    const winnerSide = resolveMergeWinnerSide(result.reason)

    const loserSide: 'left' | 'right' | 'none' =
      winnerSide === 'left' ? 'right' : winnerSide === 'right' ? 'left' : 'none'

    const winnerRecordId = winnerSide === 'left' ? intent.leftRecordId : winnerSide === 'right' ? intent.rightRecordId : null
    const loserRecordId = loserSide === 'left' ? intent.leftRecordId : loserSide === 'right' ? intent.rightRecordId : null
    const scopeId = intent.scopeId

    // Retire loser FIRST (avoid element/runtime collision on transfer).
    if (loserRecordId) {
      this.canonicalRegistry.retireRecord(loserRecordId, 'merge-superseded', 'EXPLICIT_PARAGRAPH_DELETE', scopeId)
      emitRuntimeAudit('BOUNDARY-MERGE-CANONICAL-RESOLVE', {
        batchId,
        decision: 'RETIRE_LOSER',
        loserRecordId,
        winnerRecordId: winnerRecordId ?? 'none',
        mergeReason: result.reason,
      })
    }

    // Transfer winner record if it lives on the removed side; otherwise keep live.
    if (winnerRecordId) {
      const winnerElement = winnerSide === 'left' ? intent.leftElement : intent.rightElement
      const winnerRuntimeId = winnerSide === 'left' ? intent.leftRuntimeId : intent.rightRuntimeId

      if (!winnerElement.isConnected) {
        // Case B — winner was removed; transfer to survivor.
        const ticketId = `bmt-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`
        const transferResult = this.canonicalTransferBinding(
          winnerRecordId,
          winnerElement,
          winnerRuntimeId,
          survivor,
          survivorRuntimeId,
          'BOUNDARY_MERGE_EXISTING_SURVIVOR',
          ticketId,
          scopeId,
        )
        emitRuntimeAudit('BOUNDARY-MERGE-CANONICAL-RESOLVE', {
          batchId,
          decision: transferResult.success ? 'TRANSFER_WINNER_TO_SURVIVOR' : 'TRANSFER_BLOCKED',
          winnerRecordId,
          survivorRuntimeId,
          failReason: transferResult.failReason ?? 'none',
          mergeReason: result.reason,
        })
      } else {
        // Case A — winner already on survivor; keep CURRENT_LIVE.
        emitRuntimeAudit('BOUNDARY-MERGE-CANONICAL-RESOLVE', {
          batchId,
          decision: 'RETAIN_LIVE_OWNER',
          winnerRecordId,
          survivorRuntimeId,
          mergeReason: result.reason,
        })
      }
    } else {
      // BOTH_AUTO — no explicit record to transfer.
      emitRuntimeAudit('BOUNDARY-MERGE-CANONICAL-RESOLVE', {
        batchId,
        decision: 'NO_CANONICAL_OWNER',
        mergeReason: result.reason,
      })
    }

    // Content verify — pre-keydown snapshot vs native survivor text (read-only).
    const actualMergedText = getUserVisibleParagraphText(survivor)
    const contentPreserved = actualMergedText === intent.expectedMergedText
    emitRuntimeAudit('BOUNDARY-MERGE-CONTENT-VERIFY', {
      batchId,
      phase: 'AFTER_NATIVE_MERGE',
      expectedMergedText: intent.expectedMergedText,
      actualMergedText,
      expectedCaretOffset: intent.expectedCaretOffset,
      reason: contentPreserved ? 'CONTENT_PRESERVED' : 'NATIVE_CONTENT_MISMATCH',
      overall: contentPreserved,
    })

    // Caret verify (read-only; never writes selection).
    const root = this.adapter.getEditorRoot()
    const sel = window.getSelection()
    const caretRes = root
      ? resolveSelectionParagraph(sel, root, (el: object) => this.getParagraphRuntimeId(el as HTMLElement))
      : null
    const caretCollapsed = sel?.isCollapsed ?? false
    const caretRuntimeId = caretRes?.paragraphRuntimeId ?? 'none'
    const caretOffset = caretRes?.localLogicalOffset ?? -1
    emitRuntimeAudit('BOUNDARY-MERGE-CARET-VERIFY', {
      batchId,
      selectionCollapsed: caretCollapsed,
      caretRuntimeId,
      expectedCaretOffset: intent.expectedCaretOffset,
      actualCaretOffset: caretOffset,
      caretOnSurvivor: caretRuntimeId === survivorRuntimeId,
      caretOffsetCorrect: caretOffset === intent.expectedCaretOffset,
      overall: caretCollapsed && caretRuntimeId === survivorRuntimeId && caretOffset === intent.expectedCaretOffset,
    })

    emitRuntimeAudit('BOUNDARY-MERGE-FINAL', {
      batchId,
      key: intent.key,
      direction: intent.direction,
      leftRuntimeId: intent.leftRuntimeId,
      rightRuntimeId: intent.rightRuntimeId,
      survivorRuntimeId,
      leftSemantic: intent.leftSemantic,
      rightSemantic: intent.rightSemantic,
      leftProvenSemantic,
      rightProvenSemantic,
      leftExplicitProven: intent.leftExplicitProven,
      rightExplicitProven: intent.rightExplicitProven,
      semanticWinner: result.winner,
      winnerRecordId: winnerRecordId ?? 'none',
      loserRecordId: loserRecordId ?? 'none',
      mergeReason: result.reason,
      contentPreserved,
      awaitingCount: this.canonicalRegistry.getAwaitingCount(),
      overall: contentPreserved,
    })
  }

  // ── MutationObserver ───────────────────────────────────

  private setupMutationObserver(): void {
    const root = this.adapter.detectEditorRoot()
    if (!root) return
    this.connectObserver(root)
    this.attachPasteListener(root)
    this.attachKeydownListener(root)
  }

  private connectObserver(root: HTMLElement): void {
    this.disconnectObserver()

    this.mutationObserver = new MutationObserver((mutations) => {
      // ── R58.7: Mutation attribution lock — only active NormalEnter txn gets NORMAL-ENTER traces ──
      const txn = this.activeNormalEnterTxn
      const batchId = `emb-${Date.now()}-${Math.random().toString(36).slice(2, 4)}`
      const batchOwnedByNormalEnter = !!(
        txn?.active &&
        txn.intentEpoch === this.userIntentEpoch &&
        txn.scopeId === (this.documentContext.scopeId ?? '')
      )
      if (batchOwnedByNormalEnter && txn) {
        txn.mutationBatchIds.push(batchId)
        txn.state = 'NATIVE_MUTATION_PENDING'
      }

      // ── R58.5: Generic DOM Replacement Continuity Detection ──────
      this.detectGenericDomReplacement(mutations)

      // ── Trace: T1 + T2 (fail-open: never blocks classifier) ──
      safeTrace(() => {
        const lastA = this.lastTraceSnapshot
        let oldAEl: HTMLElement | null = null
        if (lastA?.aElement) {
          const traceId = (lastA.aElement as any).traceId as string | undefined
          // Note: since trace identity is now WeakMap-based (no DOM dataset),
          // querySelector by [data-inkchapter-trace-id] will return null.
          // This is expected behavior — identity tracking is observer-external.
          if (traceId) {
            oldAEl = root.querySelector(`[data-inkchapter-trace-id="${traceId}"]`) as HTMLElement | null
          }
        }
        const caretBlock = resolveCurrentBlockFromSelection(root)
        let domModel = 'unknown'
        if (oldAEl && oldAEl.isConnected) domModel = 'D1-A-retained'
        else if (lastA?.aTextNormalized && !oldAEl) domModel = 'D2-A-replaced'
        else domModel = 'D5-other'
        traceT1_AfterNormalEnter({
          oldAIsConnected: oldAEl?.isConnected ?? false,
          oldAIdentityLabel: oldAEl ? (identifyNode(oldAEl) ?? null) : null,
          oldAElement: summarizeElement(oldAEl),
          selection: summarizeSelection(),
          caretBlock: summarizeElement(caretBlock),
          previousBlock: summarizeElement(caretBlock ? resolvePreviousBlock(caretBlock as HTMLElement, root) : null),
          domModel,
        })

        const t2Records: T2Record[] = mutations.map(m => ({
          type: m.type,
          targetTag: (m.target instanceof Element) ? m.target.tagName : m.target.nodeName,
          targetClass: (m.target instanceof HTMLElement) ? String(m.target.className).slice(0, 80) : undefined,
          targetIdentity: identifyNode(m.target),
          addedCount: m.addedNodes.length,
          addedSummaries: Array.from(m.addedNodes).slice(0, 5).map(n =>
            n instanceof HTMLElement ? { tag: n.tagName, text: n.textContent?.slice(0, 40) ?? '', class: n.className ? String(n.className).slice(0, 60) : undefined } : { type: n.nodeName }),
          removedCount: m.removedNodes.length,
          removedSummaries: Array.from(m.removedNodes).slice(0, 5).map(n =>
            n instanceof HTMLElement ? { tag: n.tagName, text: n.textContent?.slice(0, 40) ?? '', class: n.className ? String(n.className).slice(0, 60) : undefined } : { type: n.nodeName }),
        }))
        traceT2_MutationRecords(t2Records)
      })

      // ── Use classifier to determine mutation type ──
      const classification = classifyEditorMutation(mutations, root, {
        suppressParagraphDetection: this.suppressParagraphCommandDetection,
      })

      // ── Trace: T3 Classifier (fail-open) ──
      safeTrace(() => {
        traceT3_Classifier({
          headingMutation: classification.headingMutation,
          paragraphCommandCandidate: classification.paragraphCommandCandidate,
          largeBatch: classification.largeBatch,
          suppressed: this.suppressParagraphCommandDetection,
          paragraphMutationEpoch: this.paragraphMutationEpoch,
          didRequestRefresh: classification.headingMutation || (classification.paragraphCommandCandidate && !classification.largeBatch),
          refreshReason: classification.headingMutation ? 'editor-mutation' :
            (classification.paragraphCommandCandidate && !classification.largeBatch) ? 'paragraph-command-mutation' : null,
        })
      })

      // Heading structural change → editor-mutation
      if (classification.headingMutation) {
        this.requestRefresh('editor-mutation')
      }

      // Small paragraph structural change → paragraph-command-mutation
      // Only when not suppressed (plugin-authored reloads) and not large batch
      if (classification.paragraphCommandCandidate && !classification.largeBatch) {
        this.paragraphMutationEpoch++
        this.requestRefresh('paragraph-command-mutation')
      }

      // Post-hoc enforcement: check for out-of-range headings
      if (classification.headingMutation) {
        // Check added nodes for new headings that need enforcement
        for (const m of mutations) {
          for (let i = 0; i < m.addedNodes.length; i++) {
            const node = m.addedNodes[i]
            if (node instanceof HTMLElement && this.isHeadingOrContainsHeading(node)) {
              this.levelRangeEnforcer.enforceAfterMutation()
              break
            }
          }
        }
      }

      // ── R58.7: NORMAL-ENTER-POST — only when active NormalEnter txn owns this batch ──
      {
        const postTxn = this.activeNormalEnterTxn
        if (postTxn?.active && postTxn.state === 'NATIVE_MUTATION_PENDING') {
          const postRoot = this.adapter.getEditorRoot()
          const postAllParas = postRoot ? collectContentParagraphs(postRoot) : []
          const postSel = resolveSelectionTruth(
            postRoot ?? document.body,
            (el: object) => this.getParagraphRuntimeId(el as HTMLElement),
            'NORMAL-ENTER-POST',
          )

          // Collect removed/added P-level runtimeIds from mutations
          const removedRuntimeIds = new Set<string>()
          for (const m of mutations) {
            for (let ri = 0; ri < m.removedNodes.length; ri++) {
              const rn = m.removedNodes[ri]
              if (rn instanceof HTMLElement && rn.tagName === 'P') {
                removedRuntimeIds.add(this.getParagraphRuntimeId(rn))
              }
            }
          }
          const addedRuntimeIds: string[] = []
          for (const m of mutations) {
            for (let ai = 0; ai < m.addedNodes.length; ai++) {
              const an = m.addedNodes[ai]
              if (an instanceof HTMLElement && an.tagName === 'P') {
                addedRuntimeIds.push(this.getParagraphRuntimeId(an))
              }
            }
          }

          // StructuralResolution: removedSource / completedOriginal / caretDestination
          // PRIORITY: post native selection → pre/post structure → canonical record verify (not assign)
          const rPCount = removedRuntimeIds.size
          const aPCount = addedRuntimeIds.length
          const removedSourceRtId = rPCount === 1 ? [...removedRuntimeIds][0] : null

          // Determine structural decision
          let structural: StructuralDecision = 'UNKNOWN'
          const hasBrEvidence = mutations.some(m => {
            for (let ai = 0; ai < m.addedNodes.length; ai++) {
              const an = m.addedNodes[ai]
              if (an.nodeName === 'BR') return true
            }
            return false
          })
          if (rPCount === 1 && aPCount === 2) structural = 'TOP_LEVEL_SPLIT'
          else if (rPCount === 0 && aPCount === 1) structural = 'INSERT_NEW_PARAGRAPH'
          else if (rPCount === 0 && aPCount === 0 && hasBrEvidence) structural = 'SAME_PARAGRAPH_LINE_BREAK'
          else if (rPCount === 0 && aPCount === 0) structural = 'NO_TOP_LEVEL_CHANGE'
          else if (rPCount === 1 && aPCount === 1) structural = 'REPLACED_PARAGRAPH'

          // Resolve caretDestination first: use post native selection
          const caretDestRtId: string | null = postSel.runtimeId ?? null

          // Resolve completedOriginal: for TOP_LEVEL_SPLIT, the added P NOT at caret is the completed
          let completedRtId: string | null = null
          if (structural === 'TOP_LEVEL_SPLIT' && addedRuntimeIds.length === 2) {
            // If caret is on one added P, the OTHER added P is the completed original
            if (caretDestRtId && addedRuntimeIds.includes(caretDestRtId)) {
              completedRtId = addedRuntimeIds.find(id => id !== caretDestRtId) ?? null
            }
            // If no caret match, we cannot determine which is which — leave null
          } else if (structural === 'INSERT_NEW_PARAGRAPH') {
            completedRtId = null // no removed source, no completed original
          } else if (structural === 'REPLACED_PARAGRAPH' && aPCount === 1) {
            completedRtId = addedRuntimeIds[0]
          }

          // Canonical record consistency VERIFY (never assign)
          if (completedRtId && postTxn.sourceCanonicalRecordId) {
            const canonOwnerRecord = this.canonicalRegistry.resolveExactLiveRecord(
              postAllParas.find(p => this.getParagraphRuntimeId(p) === completedRtId)!
            )
            const canonOwnerRtId = canonOwnerRecord?.meta?.currentRuntimeId
            if (canonOwnerRtId && canonOwnerRtId !== completedRtId) {
              console.warn(
                `[InkChapter] CANONICAL-OWNER-MISMATCH: ` +
                `completedOriginalRuntimeId=${completedRtId} ` +
                `canonicalOwnerRuntimeId=${canonOwnerRtId} ` +
                `decision=WARN`,
              )
            }
          }

          // Resolve semantic/visual for completed and caret
          const completedPara = completedRtId
            ? postAllParas.find(p => this.getParagraphRuntimeId(p) === completedRtId) ?? null
            : null
          const caretDestPara = caretDestRtId
            ? postAllParas.find(p => this.getParagraphRuntimeId(p) === caretDestRtId) ?? null
            : null

          // Write back to transaction
          postTxn.removedSourceRuntimeId = removedSourceRtId
          postTxn.completedOriginalRuntimeId = completedRtId
          postTxn.caretDestinationRuntimeId = caretDestRtId
          postTxn.structuralDecision = structural
          postTxn.state = 'STRUCTURE_RESOLVED'

          console.info(
            `[InkChapter] NORMAL-ENTER-POST: ` +
            `normalEnterTxnId=${postTxn.id} ` +
            `intentEpoch=${postTxn.intentEpoch} ` +
            `scopeId=${postTxn.scopeId} ` +
            `structuralDecision=${structural} ` +
            `removedSourceRuntimeId=${removedSourceRtId ?? 'none'} ` +
            `completedOriginalRuntimeId=${completedRtId ?? 'none'} ` +
            `caretDestinationRuntimeId=${caretDestRtId ?? 'none'} ` +
            `removedPRuntimeIds=[${[...removedRuntimeIds].join(',')}] ` +
            `addedPRuntimeIds=[${addedRuntimeIds.join(',')}] ` +
            `completedSemantic=${completedPara ? getParagraphIndentMode(completedPara) : 'unknown'} ` +
            `completedComputedIndent=${completedPara ? window.getComputedStyle(completedPara).textIndent : 'unknown'} ` +
            `caretDestinationSemantic=${caretDestPara ? getParagraphIndentMode(caretDestPara) : 'unknown'} ` +
            `caretDestinationComputedIndent=${caretDestPara ? window.getComputedStyle(caretDestPara).textIndent : 'unknown'} ` +
            `selectionRuntimeId=${postSel.runtimeId ?? 'none'} ` +
            `selectionInsideEditor=${postSel.insideEditor} ` +
            `paragraphCount=${postAllParas.length}`,
          )

          // ── R58.7 Step 1.1: Normal success close path ──
          // Advance: STRUCTURE_RESOLVED → CARET_VERIFIED → NORMAL-ENTER-FINAL → CLOSED
          if (postSel.insideEditor && postSel.runtimeId) {
            postTxn.state = 'CARET_VERIFIED'
            const canonicalOutcome = this.lastCanonicalContinuityOutcome
            const hasCanonicalSource = !!postTxn.sourceCanonicalRecordId
            // When a canonical source exists, NORMAL-ENTER-FINAL MUST NOT report
            // overall=true if the canonical transfer failed at any layer.
            const canonicalGatePassed = !hasCanonicalSource || (canonicalOutcome?.overall ?? false)
            if (canonicalGatePassed) this.normalEnterSuccessCount++
            emitRuntimeAudit('NORMAL-ENTER-FINAL', {
              normalEnterTxnId: postTxn.id,
              caretDestinationRuntimeId: caretDestRtId ?? 'none',
              selectionInsideEditor: postSel.insideEditor,
              sourceCanonicalRecordId: postTxn.sourceCanonicalRecordId ?? 'none',
              canonicalOutcomeOverall: hasCanonicalSource ? String(canonicalOutcome?.overall ?? 'none') : 'n/a',
              overall: canonicalGatePassed,
            })
            if (canonicalGatePassed) {
              postTxn.state = 'CLOSED'
              postTxn.closedAt = Date.now()
              postTxn.closeReason = 'NORMAL_COMPLETION'
            } else {
              postTxn.state = 'FAILED'
              postTxn.closeReason = 'CANONICAL_TRANSFER_FAILED'
            }
            this.activeNormalEnterTxn = null
          } else {
            postTxn.state = 'FAILED'
            this.selectionLossCount++
            this.normalEnterFailedCount++
            console.warn(
              `[InkChapter] NORMAL-ENTER-SELECTION-LOSS: ` +
              `normalEnterTxnId=${postTxn.id} ` +
              `sourceRuntimeId=${postTxn.sourceRuntimeId} ` +
              `sourceOrdinal=${postTxn.sourceOrdinal} ` +
              `isFirstParagraph=${postTxn.isFirstParagraph} ` +
              `structuralDecision=${structural} ` +
              `decision=FAIL`,
            )
            this.activeNormalEnterTxn = null
          }
        }
      }
    })

    this.mutationObserver.observe(root, {
      childList: true,
      subtree: true,
      characterData: true,
    })

    this.store.add(() => this.disconnectObserver())
  }

  private disconnectObserver(): void {
    if (this.mutationObserver) {
      this.mutationObserver.disconnect()
      this.mutationObserver = null
    }
  }

  // ── Paste handling ──────────────────────────────────────

  /** Returns true (and logs SKIP) when the event originates from InkChapter's own UI. */
  private skipIfInkChapterUiEvent(event: Event, handler: string): boolean {
    if (!isInkChapterUiEvent(event)) return false
    console.info(
      `[InkChapter] R58-UI-GUARD handler=${handler} ` +
      `type=${event.type} decision=SKIP reason=INKCHAPTER_UI_EVENT`,
    )
    return true
  }

  private attachPasteListener(root: HTMLElement): void {
    const onPaste = (): void => {
      if (this.pasteListenerTimer !== null) clearTimeout(this.pasteListenerTimer)
      // Delay to let Typora process the paste first
      this.pasteListenerTimer = setTimeout(() => {
        this.pasteListenerTimer = null
        if (this.disposed) return
        this.levelRangeEnforcer.enforceAfterPaste()
        this.requestRefresh('editor-mutation')
      }, 50)
    }
    root.addEventListener('paste', onPaste, { passive: true })
    this.store.add(() => root.removeEventListener('paste', onPaste))
  }

  // ── Demotion interception ──────────────────────────────

  /**
   * Listen for Tab key (heading demotion) to block level changes
   * that would exceed the effective max level.
   */
  private attachKeydownListener(root: HTMLElement): void {
    const onKeyDown = (e: KeyboardEvent): void => {
      if (this.skipIfInkChapterUiEvent(e, 'tab-demotion')) return
      if (e.key !== 'Tab' || e.shiftKey) return // Only Tab (demotion), not Shift+Tab

      // Check if cursor is inside a heading
      const sel = window.getSelection()
      if (!sel?.rangeCount) return
      const node = sel.getRangeAt(0).startContainer
      const heading = node instanceof Element
        ? node.closest('h1, h2, h3, h4, h5, h6')
        : node.parentElement?.closest('h1, h2, h3, h4, h5, h6')
      if (!heading) return

      const currentLevel = parseInt(heading.tagName.charAt(1), 10)
      if (isNaN(currentLevel)) return

      const result = this.levelRangeEnforcer.checkDemotion(currentLevel)
      if (!result.allowed && result.blockedLevel != null) {
        e.preventDefault()
        e.stopPropagation()
        this.levelRangeEnforcer.showDemotionBlockedNotice(result.blockedLevel)
      }
    }

    root.addEventListener('keydown', onKeyDown, true)
    this.store.add(() => root.removeEventListener('keydown', onKeyDown, true))
  }

  private isHeadingOrContainsHeading(el: HTMLElement): boolean {
    const tag = el.tagName
    if (tag === 'H1' || tag === 'H2' || tag === 'H3' || tag === 'H4' || tag === 'H5' || tag === 'H6') {
      return true
    }
    return el.querySelector('h1, h2, h3, h4, h5, h6') !== null
  }

  // ── Editor binding ─────────────────────────────────────

  private initAdapter(): void {
    const area = this.adapter.detectEditorRoot()
    if (area) this.adapter.setEditorRoot(area)
  }

  private bindEditorRoot(): void {
    const root = this.adapter.getEditorRoot()
    if (!root) return

    // Guard: skip if already bound to the same root element
    if (this.boundEditorRoot === root) return

    // Dispose old editor-specific listeners before binding to new root
    if (this.editorRootDisposables) {
      this.editorRootDisposables.dispose()
    }
    this.editorRootDisposables = new DisposableStore()
    this.boundEditorRoot = root

    // ── Current-Line Transform: keydown = sole commit owner ──
    // Only keydown can identify token, create transaction, and commit.
    const onEnterCommand = (e: KeyboardEvent): void => {
      if (this.skipIfInkChapterUiEvent(e, 'enter-command')) return
      this.logKeyboardProvenance(e, 'onEnterCommand')

      // ── R58.7 Step 1.2: ENTER ADMISSION FIREWALL ──
      const isRealEnter = this.isRealEnterKey(e)
      const preParagraph = resolveCurrentBodyParagraph(root)
      const preVisibleText = preParagraph ? getUserVisibleParagraphText(preParagraph) : ''
      const preToken = preParagraph ? readParagraphIndentCommand(preParagraph) : null
      const admissionDecision = isRealEnter
        ? (preToken ? 'ALLOW_SPECIAL_COMMAND' : 'ALLOW_NORMAL_ENTER')
        : (e.isComposing ? 'REJECT_COMPOSITION' : 'REJECT_NON_ENTER')
      emitRuntimeAudit('ENTER-ADMISSION-AUDIT', {
        key: e.key,
        code: e.code,
        isTrusted: e.isTrusted,
        isComposing: e.isComposing,
        decision: admissionDecision,
      })

      if (!isRealEnter) {
        // IME Process/Period, composition, or non-Enter key — do NOT route to Enter pipeline
        if (e.key === 'Process') {
          this.normalEnterTxnCreatedFromNonEnterCount++
        }
        return
      }

      const handled = this.tryStartEnterIndentTransaction(e, root)

      // P0-C routing audit — locate SPECIAL→NORMAL_ENTER divergence without modifying NormalEnter.
      if (admissionDecision === 'ALLOW_SPECIAL_COMMAND') {
        const activeEmpty = this.activeEmptySpecialTransaction
        const isTokenOnlyEmpty = preToken ? isTokenOnlyEmptySpecialCommand(preVisibleText, preToken) : false
        let selectedPath: string
        let reason = ''
        if (handled) {
          selectedPath = isTokenOnlyEmpty ? 'EMPTY_SPECIAL' : 'NORMAL_ENTER'
        } else {
          selectedPath = 'NORMAL_ENTER'
          if (activeEmpty) reason = 'activeEmptySpecialTransaction-leak'
          else if (this.activeEnterTransaction) reason = 'activeEnterTransaction-leak'
          else if (!preToken) reason = 'no-token'
          else reason = 'special-command-blocked'
        }
        emitRuntimeAudit('SPECIAL-COMMAND-ROUTING-AUDIT', {
          intentId: `intent-${this.intentSeq}-${this.userIntentEpoch}`,
          intentEpoch: this.userIntentEpoch,
          visibleText: preVisibleText,
          logicalOffset: preVisibleText.length,
          admissionDecision,
          activeEmptySpecialTxnId: activeEmpty ? activeEmpty.txnId : 'none',
          activeEmptySpecialTxnState: activeEmpty ? activeEmpty.state : 'none',
          selectedPath,
          reason,
        })
      }

      if (!handled) {
        this.beginTrustedUserIntent('NORMAL_ENTER', 'keydown', 'Enter')
      }
    }
    root.addEventListener('keydown', onEnterCommand, true)
    this.editorRootDisposables.add(() => root.removeEventListener('keydown', onEnterCommand, true))

    // ── R58.6.7: Generic User Intent Capture (keydown) ──
    // Captures Delete, Arrow navigation, printable typing — BEFORE other handlers.
    const onIntentKeydown = (e: KeyboardEvent): void => {
      if (this.skipIfInkChapterUiEvent(e, 'intent-keydown')) return
      if (e.isComposing) return
      let source: UserIntentSource
      if (e.key === 'Enter' || e.key === 'Backspace') return // handled by dedicated handlers
      if (e.key === 'Delete') {
        source = 'DELETE'
      } else if (e.key === 'ArrowUp' || e.key === 'ArrowDown' || e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
        source = 'KEYBOARD_NAVIGATION'
        this.logKeyboardProvenance(e, 'onIntentKeydown')
      } else if (e.key.length === 1 && !e.ctrlKey && !e.altKey && !e.metaKey) {
        source = 'TEXT_INPUT'
      } else {
        return
      }
      this.beginTrustedUserIntent(source, 'keydown', e.key)

      // PF4: Arm boundary merge intent for Delete BEFORE native mutation.
      if (e.key === 'Delete') {
        this.armBoundaryMergeIntent('Delete')
      }
    }
    root.addEventListener('keydown', onIntentKeydown, true)
    this.editorRootDisposables.add(() => root.removeEventListener('keydown', onIntentKeydown, true))

    // ── R58.6.7: Beforeinput dedup (same physical action as preceding keydown) ──
    const onIntentBeforeInput = (e: InputEvent): void => {
      if (this.skipIfInkChapterUiEvent(e, 'intent-beforeinput')) return
      const deducedKey = (() => {
        switch (e.inputType) {
          case 'insertParagraph': return 'Enter'
          case 'deleteContentBackward': return 'Backspace'
          case 'deleteContentForward': return 'Delete'
          case 'insertText': return 'TEXT_INPUT'
          case 'insertCompositionText': return 'TEXT_INPUT'
          default: return null
        }
      })()
      if (!deducedKey) return
      // R58.7: IME text commit (insertText / insertCompositionText) is trusted
      // user input and MUST supersede a pending caret expectation — do NOT skip
      // it merely because isComposing is true. Non-text intents still skip composition.
      if (deducedKey !== 'TEXT_INPUT' && e.isComposing) return

      // R58.7: composition/dedupe audit — prevent a caret ownership storm from
      // redundant insertCompositionText events within one composition session.
      if (deducedKey === 'TEXT_INPUT' && e.inputType === 'insertCompositionText') {
        this.compositionTextInputCount++
        const now = Date.now()
        const duped = this.lastUserIntentKey === 'TEXT_INPUT' &&
          (now - this.lastUserIntentTime) < INTENT_DEDUP_WINDOW_MS
        if (duped) this.compositionDedupedCount++
        console.info(
          `[InkChapter] COMPOSITION-DEDUPE-AUDIT: ` +
          `inputType=${e.inputType} ` +
          `isComposing=${e.isComposing} ` +
          `compositionTextInputCount=${this.compositionTextInputCount} ` +
          `compositionDedupedCount=${this.compositionDedupedCount} ` +
          `windowDeduped=${duped} ` +
          `lastUserIntentKey=${this.lastUserIntentKey}`,
        )
      }

      if (deducedKey === 'TEXT_INPUT' && e.isComposing) {
        this.auditImeSelection('beforeinput', e.inputType, e.isComposing)
      }

      this.beginTrustedUserIntent(
        deducedKey === 'Enter' ? 'NORMAL_ENTER' :
        deducedKey === 'Backspace' ? 'BACKSPACE' :
        deducedKey === 'Delete' ? 'DELETE' : 'TEXT_INPUT',
        'beforeinput',
        deducedKey,
        e.inputType,
      )
    }
    root.addEventListener('beforeinput', onIntentBeforeInput, true)
    this.editorRootDisposables.add(() => root.removeEventListener('beforeinput', onIntentBeforeInput, true))

    // ── R58.6.7: Pointer/mousedown intent capture ──
    const onPointerIntent = (e: Event): void => {
      if (this.skipIfInkChapterUiEvent(e, 'pointer-intent')) return
      this.beginTrustedUserIntent('POINTER', 'pointerdown')
    }
    root.addEventListener('pointerdown', onPointerIntent, true)
    this.editorRootDisposables.add(() => root.removeEventListener('pointerdown', onPointerIntent, true))

    // beforeinput(insertParagraph) — suppress-only, NEVER commits
    const onBeforeInputInsertParagraph = (e: InputEvent): void => {
      if (this.skipIfInkChapterUiEvent(e, 'beforeinput-insert-paragraph')) return
      if (e.inputType !== 'insertParagraph') return
      const txn = this.activeEnterTransaction
      if (!txn) return // no active transaction → native
      if (txn.suppressNativeInsertParagraph) {
        e.preventDefault()
        e.stopPropagation()
        txn.traceData['beforeinput_suppressed'] = true
      }
    }
    root.addEventListener('beforeinput', onBeforeInputInsertParagraph)
    this.editorRootDisposables.add(() => root.removeEventListener('beforeinput', onBeforeInputInsertParagraph))

    // ── Backspace Indent Removal: pre-delete interception ──
    // FORCE_INDENT + caret@logical-start + Backspace → FORCE_FLUSH
    // Must intercept BEFORE Typora processes the Backspace (delete/merge).
    const onBackspaceCommand = (e: KeyboardEvent): void => {
      if (this.skipIfInkChapterUiEvent(e, 'backspace-command')) return
      if (e.key !== 'Backspace') return

      // R58.6.7: Backspace always advances user intent
      this.beginTrustedUserIntent('BACKSPACE', 'keydown', 'Backspace')

      // R58.7 Phase A: Gate — no business mutations without document context
      if (!this.assertDocumentContextReady('backspace')) return

      // ── PF4: Boundary paragraph merge priority over BACKSPACE-REVERSE ──
      // When a previous mergeable paragraph exists, Backspace at paragraph start
      // must merge (native), NOT reverse force-indent → force-flush.
      if (this.armBoundaryMergeIntent('Backspace')) {
        emitRuntimeAudit('BACKSPACE-ADMISSION', {
          decision: 'ALLOW_NATIVE_BOUNDARY_MERGE',
          intentEpoch: this.userIntentEpoch,
        })
        return // do NOT preventDefault — let Typora native merge
      }

      const settings = this.getParagraphLayoutSettings()

      const ctx = shouldConsumeBackspaceForIndentRemoval(
        root,
        settings,
        this.isInComposition || e.isComposing,
      )

      // Not our concern — let Typora handle natively
      if (!ctx || !ctx.caretAtLogicalStart) return

      // ── PF4: Consume Backspace (reverse-to-flush) only when no previous mergeable ──
      emitRuntimeAudit('BACKSPACE-ADMISSION', {
        decision: 'CONSUME_REMOVE_INDENT',
        intentEpoch: this.userIntentEpoch,
      })

      // ── Consume Backspace, apply force-flush ──
      e.preventDefault()
      e.stopPropagation()

      const para = ctx.paragraph
      const paraRuntimeId = this.getParagraphRuntimeId(para)

      // ── R58.5: Resolve LiveOwnershipProof for Backspace ──
      const bsDocKeyProof = this.getDocumentKey() ?? ''
      const proof = this.canonicalRegistry.resolveLiveOwnershipProof(
        para, bsDocKeyProof, paraRuntimeId,
      )
      if (!proof) {
        console.info(
          `[InkChapter] BACKSPACE-CANONICAL-BLOCK: runtimeId=${paraRuntimeId} ` +
          `reason=NO_LIVE_OWNERSHIP_PROOF — no valid proof for Backspace`,
        )
        return
      }

      // Validate generation lease
      const genCheck = this.canonicalRegistry.validateProofGeneration(proof, 'BACKSPACE_UPDATE')
      if (!genCheck.ok) {
        console.error(
          `[InkChapter] STALE-LIVE-OWNERSHIP-PROOF: ` +
          `recordId=${proof.recordId} intent=BACKSPACE_UPDATE ` +
          `reason=${genCheck.reason} ACTION=BLOCK`,
        )
        return
      }

      logger.info(`BACKSPACE-REVERSE: force-indent → force-flush runtimeId=${paraRuntimeId} ordinal=${collectContentParagraphs(root).indexOf(para)}`)

      // R58: Semantic + visual directly; sidecar via live binding pipeline
      setParagraphIndentMode(para, 'force-flush', WriterIds.BACKSPACE_SEMANTIC)
      const bsSettings = this.getParagraphLayoutSettings()
      applyEffectiveParagraphIndent(para, 'flush', WriterIds.BACKSPACE_SEMANTIC)

      // ── R58.4: CANONICAL-RECORD-BACKSPACE via registry (UPDATE_EXISTING only + firewall) ─
      const bsDocKey = this.getDocumentKey() ?? ''
      const bsDocPath = this.ctx.getActiveFilePath?.() ?? 'unknown'
      const bsRecordsBefore = (this.inMemoryOverrides.get(bsDocKey) ?? []).length
      const bsSidecarResult = this.canonicalUpdateBackspace(
        para, 'force-flush', paraRuntimeId, bsDocKey, bsDocPath,
      )
      const bsRecordsAfter = (this.inMemoryOverrides.get(bsDocKey) ?? []).length
      const bsRecordId = bsSidecarResult.recordId
      const bsDecision = bsSidecarResult.decision

      console.info(
        `[InkChapter] CANONICAL-RECORD-BACKSPACE: runtimeId=${paraRuntimeId} ` +
        `recordId=${bsRecordId} ` +
        `recordCountBefore=${bsRecordsBefore} recordCountAfter=${bsRecordsAfter} ` +
        `modeBefore=FORCE_INDENT modeAfter=FORCE_FLUSH ` +
        `sameRecord=${bsRecordsAfter === bsRecordsBefore} ` +
        `decision=${bsDecision} ` +
        `appendOccurred=${bsRecordsAfter > bsRecordsBefore}`,
      )

      // ── r57: Update active handoff semantic if this paragraph is the handoff owner ──
      const handoff = this.activeOneShotHandoff
      if (handoff && !handoff.consumed && handoff.preElement === para) {
        handoff.semantic = 'force-flush'
        logger.info(`HANDOFF-SEMANTIC-UPDATED: ${handoff.handoffId} force-indent → force-flush via Backspace`)
      }

      // ── r57: VERIFY-FIRST Caret — same pipeline as Enter ──
      const bsDoc = para.ownerDocument
      const bsSel = bsDoc?.defaultView?.getSelection() ?? null
      const bsSelRes = resolveSelectionParagraph(
        bsSel,
        root,
        (el: object) => this.getParagraphRuntimeId(el as HTMLElement),
      )

      const bsAlreadyCorrect =
        bsSelRes.paragraphRuntimeId === paraRuntimeId &&
        (bsSelRes.localLogicalOffset ?? -1) === 0

      if (bsAlreadyCorrect) {
        // Caret already in correct position — no write needed
        logger.info(`BACKSPACE-CARET-VERIFY: runtimeId=${paraRuntimeId} alreadyCorrect=true caretWriteAttempted=false`)
      } else {
        // Repair via shared pipeline
        logger.info(`BACKSPACE-CARET-VERIFY: runtimeId=${paraRuntimeId} alreadyCorrect=false repair needed (resolvedRuntimeId=${bsSelRes.paragraphRuntimeId ?? 'null'} offset=${bsSelRes.localLogicalOffset})`)
        const bsRepair = repairCaretAtParagraphLogicalStart(
          para,
          root,
          paraRuntimeId,
          (el: object) => this.getParagraphRuntimeId(el as HTMLElement),
        )
        this.recordPluginSelectionWrite(
          `write-${paraRuntimeId}-${Date.now()}`,
          'CARET-REPAIR',
          'BACKSPACE-CARET-REPAIR',
          paraRuntimeId,
          bsSelRes.localLogicalOffset ?? null,
          0,
          bsRepair.success,
        )
        logger.info(`BACKSPACE-CARET-REPAIR: method=${bsRepair.method} success=${bsRepair.success} resolvedRuntimeId=${bsRepair.resolvedParagraphRuntimeId ?? 'null'} localOffset=${bsRepair.localLogicalOffset}`)
      }
    }
    root.addEventListener('keydown', onBackspaceCommand, true)
    this.editorRootDisposables.add(() => root.removeEventListener('keydown', onBackspaceCommand, true))

    // ── Forensic: beforeinput recording (passive, no mutation) ──
    const onBeforeInput = (e: InputEvent): void => {
      if (this.skipIfInkChapterUiEvent(e, 'forensic-beforeinput')) return
      // P0-VC Phase B observability: capture BEFORE snapshot for empty→nonempty.
      if (e.inputType === 'insertText' || e.inputType === 'insertCompositionText') {
        this.pendingEmptyNonemptyBefore = this.captureEmptyNonemptyBefore(e.inputType, e.isComposing)
      }
      safeForensic(() => {
        const block = resolveCurrentBlockFromSelection(root)
        if (!block || block.tagName !== 'P') return
        const state = captureParagraphState(block)
        state.candidate = 'beforeinput'
        const prospective = (block.textContent ?? '') + (e.data ?? '')
        writeForensicEntry('T0_beforeinput', {
          eventType: e.inputType,
          eventData: e.data,
          isComposing: e.isComposing,
          currentTextContent: block.textContent,
          prospectiveText: prospective,
          paragraphState: state,
          selection: captureSelectionState(block),
        })
      })
    }
    root.addEventListener('beforeinput', onBeforeInput, { passive: true })
    this.editorRootDisposables.add(() => root.removeEventListener('beforeinput', onBeforeInput))

    // input
    const onInput = (e: Event): void => {
      if (this.skipIfInkChapterUiEvent(e, 'editor-input')) return
      // ── R58.7: IME/composition input selection timing ──
      this.auditImeSelection('input', 'input', this.isInComposition)
      // P0-VC Phase B observability: emit empty→nonempty transition if pending.
      this.emitEmptyNonemptyTransitionIfPending(root)
      // ── R58.7: post-insert T_INPUT_EVENT sample + direct-text commit anchor ──
      this.samplePostTextInputInputEvent()
      if (!this.isInComposition) {
        this.commitPostTextInputObservation('INPUT_EVENT')
      }
      // ── Forensic: T1 after native insertion, before projection ──
      safeForensic(() => {
        const block = resolveCurrentBlockFromSelection(root)
        if (!block || block.tagName !== 'P') return
        const state = captureParagraphState(block)
        const settings = this.getParagraphLayoutSettings()
        const semantic = getParagraphIndentMode(block)
        const userVisible = getUserVisibleParagraphText(block)
        const token = readParagraphIndentCommand(block)
        state.semantic = semantic
        state.candidate = token ? 'exact-token' : 'none'
        state.documentDefault = settings.defaultIndent
        writeForensicEntry('T1_after_native_insertion', {
          rawTextContent: block.textContent,
          userVisibleText: userVisible,
          indentCommandToken: token,
          semantic,
          settingsDefault: settings.defaultIndent,
          isComposing: this.isInComposition,
          paragraphState: state,
          parentChain: captureParentChain(block),
          matchedCSS: captureMatchedCSSRules(block, 'text-indent'),
        })
      })

      // Immediate local projection for current paragraph (no candidate logic)
      this.projectCurrentParagraphLocally(root)

      // ── SINGLE-DOT-TRACE (P0 diagnostic) ──
      // Auto-trace single "." / "。" input to verify semantic stays AUTO.
      {
        const dotBlock = resolveCurrentBlockFromSelection(root)
        const dotSettings = this.getParagraphLayoutSettings()
        this.traceSingleDotIfMatch(dotBlock, dotSettings)
      }

      // ── Forensic: T2 after local projection ──
      safeForensic(() => {
        const block = resolveCurrentBlockFromSelection(root)
        if (!block || block.tagName !== 'P') return
        const state = captureParagraphState(block)
        writeForensicEntry('T2_after_local_projection', {
          paragraphState: state,
          localProjectionCalled: true,
          localTargetIsP: block.tagName === 'P',
          localTargetId: (block as HTMLElement).dataset ? undefined : undefined,
        })
      })

      if (!this.isInComposition) this.requestRefresh('editor-input')

      // ── Forensic: T6 next RAF ──
      safeForensic(() => {
        requestAnimationFrame(() => {
          safeForensic(() => {
            const block = resolveCurrentBlockFromSelection(root)
            if (!block || block.tagName !== 'P') return
            writeForensicEntry('T6_next_RAF', {
              paragraphState: captureParagraphState(block),
            })
          })
        })
      })

      // ── Forensic: T7 100ms final ──
      safeForensic(() => {
        setTimeout(() => {
          safeForensic(() => {
            const block = resolveCurrentBlockFromSelection(root)
            if (!block || block.tagName !== 'P') return
            const state = captureParagraphState(block)
            const settings = this.getParagraphLayoutSettings()
            const indentToken = readParagraphIndentCommand(block)
            state.candidate = indentToken ? 'exact-token' : 'none'
            state.semantic = getParagraphIndentMode(block)
            state.documentDefault = settings.defaultIndent
            writeForensicEntry('T7_final_100ms', {
              paragraphState: state,
              parentChain: captureParentChain(block),
              matchedCSS: captureMatchedCSSRules(block, 'text-indent'),
              selection: captureSelectionState(block),
              SEMANTIC: state.semantic,
              INDENT_TOKEN: indentToken,
              DEFAULT: state.documentDefault,
              COMPUTED_TEXT_INDENT: state.computedTextIndent,
              COMPUTED_MARGIN_LEFT: state.computedMarginLeft,
              VISUAL_OFFSET_PX: state.visualOffsetPx,
            })
          })
        }, 100)
      })
    }
    root.addEventListener('input', onInput, { passive: true })
    this.editorRootDisposables.add(() => root.removeEventListener('input', onInput))

    // composition
    const onCompositionEnd = (e: Event): void => {
      if (this.skipIfInkChapterUiEvent(e, 'composition-end')) return
      this.auditImeSelection('compositionend', 'none', false)
      // ── R58.7: IME text commit anchor — COMMIT+0 stability starts here ──
      this.commitPostTextInputObservation('COMPOSITION_END')
      this.isInComposition = false
      // Immediate local projection after composition ends
      this.projectCurrentParagraphLocally(root)
      this.requestRefresh('composition-end')
      this.imeCompositionActiveSessionId = ''
    }
    root.addEventListener('compositionend', onCompositionEnd)
    this.editorRootDisposables.add(() => root.removeEventListener('compositionend', onCompositionEnd))

    const onCompositionStart = (e: Event): void => {
      if (this.skipIfInkChapterUiEvent(e, 'composition-start')) return
      this.isInComposition = true
      this.imeCompositionSessionSeq++
      this.imeCompositionActiveSessionId = `ime-${this.imeCompositionSessionSeq}-${Date.now()}`
      this.auditImeSelection('compositionstart', 'none', true)
    }
    root.addEventListener('compositionstart', onCompositionStart)
    this.editorRootDisposables.add(() => root.removeEventListener('compositionstart', onCompositionStart))

    const onCompositionUpdate = (e: Event): void => {
      if (this.skipIfInkChapterUiEvent(e, 'composition-update')) return
      this.auditImeSelection('compositionupdate', 'none', this.isInComposition)
    }
    root.addEventListener('compositionupdate', onCompositionUpdate)
    this.editorRootDisposables.add(() => root.removeEventListener('compositionupdate', onCompositionUpdate))

    // focusin
    const onFocusIn = (e: Event): void => {
      if (this.skipIfInkChapterUiEvent(e, 'focus-in')) return
      this.requestRefresh('focus-in')
      this.scheduleTail('decoration-repair', FOCUS_TAIL_MS)
    }
    root.addEventListener('focusin', onFocusIn)
    this.editorRootDisposables.add(() => root.removeEventListener('focusin', onFocusIn))

    // click
    const onClick = (e: Event): void => {
      if (this.skipIfInkChapterUiEvent(e, 'editor-click')) return
      this.requestRefresh('editor-click')
    }
    root.addEventListener('click', onClick, { passive: true })
    this.editorRootDisposables.add(() => root.removeEventListener('click', onClick))

    // keyup
    const onKeyUp = (e: Event): void => {
      if (this.skipIfInkChapterUiEvent(e, 'editor-keyup')) return
      this.requestRefresh('editor-keyup')
    }
    root.addEventListener('keyup', onKeyUp, { passive: true })
    this.editorRootDisposables.add(() => root.removeEventListener('keyup', onKeyUp))
  }

  /** Detach editor root listeners (called on root change). */
  private unbindEditorRoot(): void {
    this.cancelPostTextInputStabilityObservation('EDITOR_UNBOUND')
    if (this.editorRootDisposables) {
      this.editorRootDisposables.dispose()
      this.editorRootDisposables = null
    }
    this.boundEditorRoot = null
  }

  // ── Event registration ─────────────────────────────────

  private registerEvents(): void {
    const { ctx } = this

    // Initial bind
    const root = this.adapter.detectEditorRoot()
    if (root) {
      this.adapter.setEditorRoot(root)
      this.bindEditorRoot()
    }

    // Editor DOM load
    this.store.add(
      ctx.onEditorEvent('load', (editorEl: unknown) => {
        this.flushSidecarWrite()
        this.loadDocumentContext()
        recordRuntimeAudit('editor:load', { documentKey: this.getDocumentKey() ?? 'none', settingsSource: this.docContext.source })
        if (editorEl instanceof HTMLElement) {
          this.adapter.setEditorRoot(editorEl)
          // ── R58.7 Phase A.1.1: Bind editor runtime + refresh context IMMEDIATELY ──
          this.bindEditorRuntime(editorEl)
          this.refreshDocumentContext()
          this.lastSnapshot = null
          this.renderedStates = null
          this.connectObserver(editorEl)
          this.bindEditorRoot()
          // Authoritative documentKey MUST be read AFTER refreshDocumentContext():
          // the active file may only become available after the editor context refresh.
          this.syncOutlineDocumentContext('editor-load')
          this.outlineToolbar.reinitialize()
          queueMicrotask(() => this.requestRefresh('initial-load'))
          this.scheduleTail('decoration-repair', TAIL_REFRESH_MS)
          // Reconstruct paragraph indent overrides from sidecar after DOM settles
          setTimeout(() => this.reconstructParagraphOverridesFromSidecar(), 100)
          // Normal Enter Trace: OFF by default. Enable via window.__INKCHAPTER_NORMAL_ENTER_TRACE__
          // Forensic Probe: OFF by default. Enable via window.__INKCHAPTER_PARAGRAPH_FORENSIC__
          // Then call window.__inkchapter_activate_forensic__() from DevTools to activate.
          ;(window as any).__inkchapter_activate_forensic__ = () => activateForensic()
          setTimeout(() => activateForensic(), 200)
          // Single-dot diagnostic: call __inkchapter_diagnose_single_dot__() from DevTools
          ;(window as any).__inkchapter_diagnose_single_dot__ = () => {
            const rt = this.adapter.getEditorRoot()
            if (!rt) return 'no editor root'
            const p = resolveCurrentBodyParagraph(rt)
            if (!p) return 'no current paragraph'
            const settings = this.getParagraphLayoutSettings()
            return {
              SINGLE_DOT_UI_SETTING: settings.defaultIndent,
              SINGLE_DOT_RESOLVED_DEFAULT: resolveEffectiveParagraphIndent('auto', settings.defaultIndent),
              SINGLE_DOT_SEMANTIC: getParagraphIndentMode(p),
              SINGLE_DOT_COMPUTED_TEXT_INDENT: window.getComputedStyle(p).textIndent,
              SINGLE_DOT_RAW_TEXT: p.textContent,
              SINGLE_DOT_VISIBLE_TEXT: getUserVisibleParagraphText(p),
              SINGLE_DOT_EFFECTIVE_CLASS_INDENT: p.classList.contains('inkchapter-paragraph-effective-indent-2'),
              SINGLE_DOT_EFFECTIVE_CLASS_FLUSH: p.classList.contains('inkchapter-paragraph-effective-flush'),
            }
          }
        }
      }),
    )

    // Framework edit (fallback)
    this.store.add(
      ctx.onEditorEvent('edit', () => this.requestRefresh('framework-edit')),
    )

    // ── R58.7 Phase A.1.3: File will-save — create pending persistence promotion ──
    this.store.add(
      ctx.onWorkspaceEvent('file:will-save' as any, (file: any) => {
        const path = file?.path ?? file ?? null
        const scopeId = this.documentContext.scopeId
        const editorRoot = this.adapter.getEditorRoot()
        const editorInstanceId = this.getOrCreateEditorInstanceId(editorRoot)
        const isUntitled = !this.ctx.getActiveFilePath?.()
        if (isUntitled && scopeId && editorInstanceId) {
          this.pendingPersistencePromotion = {
            promotionId: `promo-${Date.now()}`,
            scopeId,
            editorInstanceId,
            source: 'SAVE_AS_COMMAND',
            targetPath: typeof path === 'string' ? path : null,
            createdAt: Date.now(),
            consumed: false,
          }
          console.info(
            `[InkChapter] PERSISTENCE-PROMOTION-PENDING: ` +
            `promotionId=${this.pendingPersistencePromotion.promotionId} ` +
            `scopeId=${scopeId} ` +
            `editorInstanceId=${editorInstanceId} ` +
            `source=WILL_SAVE ` +
            `targetPath=${this.pendingPersistencePromotion.targetPath ?? 'null'} ` +
            `decision=CREATE`,
          )
        }
      }),
    )

    // File open — load document context, bump version, reinit outline
    this.store.add(
      ctx.onWorkspaceEvent('file:open', () => {
        this.flushSidecarWrite()
        const version = ++this.renderVersion
        this.loadDocumentContext()
        const newDocKey = this.getDocumentKey()
        const activePath = this.ctx.getActiveFilePath?.()
        // ── R58.6.6: RUNTIME-IDENTITY-FINAL — no hard-coded build, use authoritative session ──
        emitRuntimeAudit('RUNTIME-IDENTITY-FINAL', {
          reason: 'file-open',
          vaultRoot: this.ctx.vaultRoot ?? 'unknown',
          activeDoc: activePath ?? 'unknown',
          initializationCount: 1,
          sessionId: this.canonicalRegistry.sessionId,
        })
        recordRuntimeAudit('file:open:received', {
          documentKey: newDocKey ?? 'none',
          settingsSource: this.docContext.source,
          renderVersion: version,
        })
        this.lastSnapshot = null
        this.renderedStates = null
        this.outlineController.bumpRenderVersion()
        this.outlineController.reinitialize()
        this.syncOutlineDocumentContext('file-open')
        this.outlineToolbar.reinitialize()
        this.overrideStore = null // Invalidate override store for new doc
        queueMicrotask(() => {
          if (version !== this.renderVersion) { return }
          const area = this.adapter.detectEditorRoot()
          if (area) {
            this.adapter.setEditorRoot(area)
            this.bindEditorRuntime(area)
            this.refreshDocumentContext()
            this.connectObserver(area)
            this.bindEditorRoot()
          }
          this.requestRefresh('file-open')
          this.scheduleTail('decoration-repair', TAIL_REFRESH_MS)
          // Reconstruct sidecar overrides
          setTimeout(() => this.reconstructParagraphOverridesFromSidecar(), 120)
        })
        if (this.fileOpenRetryTimer !== null) clearTimeout(this.fileOpenRetryTimer)
        this.fileOpenRetryTimer = setTimeout(() => {
          this.fileOpenRetryTimer = null
          if (this.disposed) return
          if (version !== this.renderVersion) return
          const area = this.adapter.detectEditorRoot()
          if (area && (!this.lastSnapshot || this.lastSnapshot.length === 0)) {
            this.adapter.setEditorRoot(area)
            this.connectObserver(area)
            this.bindEditorRoot()
            this.requestRefresh('file-open')
          }
        }, 100)
      }),
    )

    // Active leaf change — load document context, bump version, reinit outline, rebind observer + editor root
    this.store.add(
      ctx.onWorkspaceEvent('active-leaf:change', () => {
        const version = ++this.renderVersion
        this.loadDocumentContext()
        const newDocKey = this.getDocumentKey()
        recordRuntimeAudit('active-leaf:change', {
          documentKey: newDocKey ?? 'none',
          settingsSource: this.docContext.source,
          renderVersion: version,
        })
        this.lastSnapshot = null
        this.renderedStates = null
        this.outlineController.bumpRenderVersion()
        this.outlineController.reinitialize()
        this.outlineToolbar.reinitialize()
        this.outlineToolbar.setDocumentKey(newDocKey ?? '')
        this.overrideStore = null
        queueMicrotask(() => {
          if (version !== this.renderVersion) { return }
          const area = this.adapter.detectEditorRoot()
          if (area) {
            this.adapter.setEditorRoot(area)
            this.bindEditorRuntime(area)
            this.refreshDocumentContext()
            this.connectObserver(area)
            this.bindEditorRoot()
          }
          this.requestRefresh('active-leaf-change')
          this.scheduleTail('decoration-repair', TAIL_REFRESH_MS)
        })
        setTimeout(() => {
          if (version !== this.renderVersion) return
          const area = this.adapter.detectEditorRoot()
          if (area && (!this.lastSnapshot || this.lastSnapshot.length === 0)) {
            this.adapter.setEditorRoot(area)
            this.connectObserver(area)
            this.bindEditorRoot()
            this.requestRefresh('active-leaf-change')
          }
        }, 100)
      }),
    )

    ctx.registerDisposable(() => this.dispose())
  }
}

/**
 * NOTE: The previous `buildEffectiveLayouts` level-shift (strict H2→h1) has
 * been removed. Heading layout is now resolved per structure mode via
 * `resolveHeadingLayoutsForMode` and applied with physical H1-H6 keys — real
 * H2 always uses layout.h2, never layout.h1.
 */

/** Find the text node within an element that contains a given substring. */
function findTextNodeContaining(el: HTMLElement, substr: string): Text | null {
  const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT)
  while (walker.nextNode()) {
    const node = walker.currentNode as Text
    if (node.textContent?.includes(substr)) return node
  }
  return null
}
