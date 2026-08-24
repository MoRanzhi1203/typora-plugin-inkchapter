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
import { CaptionDomAdapter, MATH_HOST_SELECTOR, type CaptionTarget, type ReconcileItem, type ReconcileStats } from './caption-dom-adapter'
import { loadCaptionStore, saveCaptionStore } from './caption-store'
import { emitRuntimeAudit, emitRuntimeAuditStateDedup } from '../runtime/forensic-log-sink'
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
  type ObjectNumberingConfig,
  type ObjectNumberingType,
  type NumberingTarget,
} from './object-numbering-engine'
import { migrateObjectNumberingConfig } from './object-numbering-settings'
import { FormulaNumberingAdapter, type FormulaReconcileItem, type FormulaTarget } from './formula-numbering-adapter'
import { planFormulaSemanticNumbers, type FormulaSemanticContext, type FormulaSemanticPlanEntry } from './formula-semantic-planner'
import {
  FormulaProjectionController,
  classifyFormulaProjectionVerify,
  classifyPlanChange,
  hashFormulaSource,
  normalizeTyporaAutoNumberingPolicy,
  scanDisplayMathSources,
  type FormulaNativeRenderPlan,
  type FormulaProjectionContext,
} from './formula-projection-controller'
import { ensureMathJaxRenderInputHook, getMathJaxHookLifecycle, type FormulaProjectionLiveContext } from './mathjax-render-input-hook'
import type { HeadingNumberingSnapshot } from './heading-numbering-snapshot'
import { computeProductionDesiredCaptionStates, type CaptionObjectEntry, type ProductionObjectConfigs } from './caption-semantic-bridge'
import {
  NumberingReconcileScheduler,
  RECONCILE_INVALIDATION,
  SEMANTIC_STRUCTURAL_INVALIDATION_MASK,
  type PendingNumberingReconcile,
  type ReconcileInvalidationKey,
} from './reconcile-scheduler'
import {
  DocumentOpenPerfTracker,
  forensicVerboseEnabled,
  getActivePerfTracker,
  registerActivePerfTracker,
} from './document-open-perf'
import {
  buildObjectStructureFingerprint,
  computeHeadingSemanticFingerprint,
  fastHash,
  objectStructureFingerprintEqual,
  type ObjectStructureFingerprint,
} from './numbering-fast-path'
import {
  classifyFormulaSemanticResolution,
  isResolvedFormulaSemantic,
  resolutionToFormulaContext,
  type FormulaSemanticResolution,
} from './formula-semantic-resolution'
import {
  computePlanSetPublish,
  decideFormulaCandidateCoherence,
  type FormulaCandidateCoherenceDecision,
  type FormulaPlanSetPublishDecision,
} from './formula-plan-set-coherence'
import {
  incHeadingSemanticPerf,
  emitHeadingSemanticPerfSummary,
} from './heading-semantic-perf'
import {
  CaptionDeferredRetryController,
  buildCaptionReconcileStateToken,
  buildCaptionFailureSignature,
  buildCaptionTargetFingerprint,
} from './caption-reconcile-retry'
import {
  CaptionHeadingAuthorityGate,
  resolveCaptionHeadingAuthority,
  type CaptionHeadingAuthorityState,
  type CaptionAuthorityGateDecision,
} from './caption-heading-authority'
import type { CanonicalHeadingFrame } from './canonical-heading-frame'

/**
 * Phase 7R.3.6-H/I: offline Formula plan-set candidate. Built completely OFF to
 * the side of the live plan map; only a COMPLETE candidate is atomically
 * published as the current authoritative plan set.
 */
export interface FormulaPlanSetCandidate {
  documentKey: string
  editorStructureEpoch: number
  snapshotRevision: number
  headingBindingGeneration: number
  canonicalHostFingerprint: string
  expectedFormulaHostCount: number
  resolvedFormulaCount: number
  transientUnresolvedCount: number
  resolutions: FormulaSemanticResolution[]
  /** Publishable per-host plans (inkchapter + non-empty source), in target order. */
  planEntries: Array<{ target: FormulaTarget; plan: FormulaNativeRenderPlan }>
}

/** The ONE live authoritative COMPLETE plan set per document (Phase 7R.3.6-I §28). */
export interface FormulaCompletePlanSet {
  planSetEpoch: number
  documentKey: string
  editorStructureEpoch: number
  snapshotRevision: number
  headingBindingGeneration: number
  canonicalHostFingerprint: string
  targets: FormulaTarget[]
  plans: Map<HTMLElement, FormulaNativeRenderPlan>
}

/**
 * Phase 7R.3.7: the ONE live authoritative COMPLETE caption plan set per
 * document. Built OFF to the side; published ONLY when COMPLETE. While a
 * candidate is TRANSIENT_UNRESOLVED the previous COMPLETE set stays visible
 * (projectionWrites=0) — a transient resolver failure NEVER becomes a fake
 * GLOBAL caption (表 1 / 图 1 / 代码 1).
 */
export interface CaptionCompleteCaptionPlanSet {
  documentKey: string
  snapshotRevision: number
  editorStructureEpoch: number
  headingBindingGeneration: number
  expectedTargetCount: number
  resolvedTargetCount: number
  states: import('./caption-semantic-bridge').ProductionDesiredCaptionState[]
}

/** Phase 7R.3.7 caption candidate coherence decision (mirrors Formula). */
export type CaptionCandidateCoherenceDecision =
  | 'COMPLETE'
  | 'DEFER_TRANSIENT_UNRESOLVED'

export interface CaptionServiceContext {
  vaultRoot?: string | null
  getActiveFilePath?: () => string | null
  getDocumentKey?: () => string | null
  getEditorRoot?: () => HTMLElement | null
  getMarkdown?: () => string
  /** Phase 6: authoritative heading snapshot consumed for Figure/Table/Code numbering. */
  getHeadingNumberingSnapshot?: () => HeadingNumberingSnapshot | null
  /** Phase 6.1: canonical identity-based nearest-preceding-heading resolver. */
  resolvePrecedingSemanticHeading?: (target: HTMLElement) => {
    documentKey: string
    revision: number
    headingStableIdentity: string
    semanticState: import('./semantic-heading-types').SemanticHeadingNumberState
  } | null
  /** Phase 7R.3.4-E / 7R.3.6-G: batch resolver — bind many targets in ONE forward
   *  sweep with an EXPLICIT per-target outcome (bound vs unbound reason). */
  resolvePrecedingSemanticHeadingBatch?: (targets: HTMLElement[]) => Array<
    | {
        bound: true
        documentKey: string
        revision: number
        headingStableIdentity: string
        semanticState: import('./semantic-heading-types').SemanticHeadingNumberState
      }
    | { bound: false; reason: string; candidateStableIdentity?: string }
  >
  /** Phase 7R.3.6-F: canonical heading binding generation (plan provenance). */
  getHeadingBindingGeneration?: () => number
  /** Phase 7R.3.9: committed canonical heading frame fingerprint (if frame authority exists). */
  getCanonicalHeadingFrameFingerprint?: () => string
  /** Phase 7R.3.9R: the committed CanonicalHeadingFrame (readiness authority). */
  getCanonicalHeadingFrame?: () => CanonicalHeadingFrame | null
  /** Phase 7R.3.9R: subscribe to CanonicalHeadingFrame commits. emitCurrent=true
   *  immediately replays the current committed frame (subscribe-first + catch-up,
   *  so a commit racing the subscription is never missed). */
  subscribeCanonicalHeadingFrame?: (
    listener: (frame: CanonicalHeadingFrame | null) => void,
    opts?: { emitCurrent?: boolean },
  ) => () => void
  reloadContent?: (markdown: string) => void
  /** Read the active .md file bytes from disk (for FAW6 persistence evidence). */
  readActiveFileContent?: () => string | null
  onEditorEvent?: <K extends string>(event: K, listener: (...args: never[]) => void) => () => void
  onWorkspaceEvent?: <K extends string>(event: K, listener: (...args: never[]) => void) => () => void
  registerDisposable?: (fn: () => void) => void
}

const REFRESH_DELAY_MS = 0

/** Read-only probe of Typora's global auto-numbering preference (Phase 7R.2 forensic). */
function readTyporaAutoNumberingForMath(): string | boolean | undefined {
  const g = globalThis as { File?: { option?: { autoNumberingForMath?: string | boolean } } }
  return g.File?.option?.autoNumberingForMath
}

export type CaptionMutationClassification = 'SELF_ONLY' | 'CONTENT_RELEVANT' | 'MIXED'

/**
 * Classify a mutation batch as caption-decoration-only, real-content, or mixed.
 * Checks target AND addedNodes AND removedNodes so caption insert/remove/text
 * updates (whose target may be a parent container, not the caption itself) are
 * all recognized as self-mutations.
 */
export function classifyCaptionMutationBatch(records: MutationRecord[]): CaptionMutationClassification {
  let captionOnly = 0
  let content = 0
  for (const record of records) {
    const targetIsCaption = record.target instanceof Element
      && !!record.target.closest(`[data-inkchapter-caption]`)
    const addedAllCaption = Array.from(record.addedNodes).every(n =>
      n instanceof Element && (n.matches(`[data-inkchapter-caption]`) || !!n.closest(`[data-inkchapter-caption]`)))
    const removedAllCaption = Array.from(record.removedNodes).every(n =>
      n instanceof Element && (n.matches(`[data-inkchapter-caption]`) || !!n.closest(`[data-inkchapter-caption]`)))
    const hasAdded = record.addedNodes.length > 0
    const hasRemoved = record.removedNodes.length > 0
    const isCaptionMutation = targetIsCaption || (hasAdded && addedAllCaption) || (hasRemoved && removedAllCaption)
    if (isCaptionMutation) captionOnly++
    else content++
  }
  if (captionOnly > 0 && content === 0) return 'SELF_ONLY'
  if (content > 0 && captionOnly === 0) return 'CONTENT_RELEVANT'
  return 'MIXED'
}

export type EditorMutationClassification =
  | 'SELF_ONLY'            // InkChapter caption decorations only
  | 'RENDERER_ONLY'        // MathJax output (mjx-container/.MathJax/preview) only
  | 'FORMULA_SOURCE_CHANGED' // Formula TeX/source text changed (script inside md-math-block)
  | 'FORMULA_STRUCTURE_CHANGED' // Genuine logical Formula host add/remove (Phase 7R.3.6)
  | 'CONTENT_RELEVANT'     // headings / tables / figures / code / anything else

const MATH_RENDERER_SELECTOR = 'mjx-container, .MathJax, .md-mathjax-preview, mjx-assistive-mml, .mjx-chtml'
const FORMULA_LOGICAL_HOST_SELECTOR_M = '.md-math-block'
/**
 * Phase 7R.3.9: code-block renderer internals. Typora initialises one CodeMirror
 * editor per `.md-fences` fence and re-renders its lines lazily. Those mutations
 * are renderer output, NOT business content — treating them as CONTENT_RELEVANT
 * causes an unbounded full-caption reconcile loop on large code-heavy documents.
 * Only the fence element itself (`.md-fences` add/remove) is a structural change.
 */
const CODE_BLOCK_RENDERER_SELECTOR = '.md-fences'

/** Node strictly INSIDE a code-block renderer (never the fence element itself). */
function inCodeBlockRenderer(node: Node, fallbackTarget?: Node | null): boolean {
  if (node instanceof Element) {
    if (node.matches(CODE_BLOCK_RENDERER_SELECTOR)) return false
    return !!node.closest(CODE_BLOCK_RENDERER_SELECTOR)
  }
  // Removed text/BR nodes are already detached from the tree (parentElement is
  // null by the time the observer delivers the record); fall back to the
  // mutation target, which is the container the mutation happened in.
  const parent = node.parentElement ?? (fallbackTarget instanceof Element ? fallbackTarget : null)
  if (!parent) return false
  if (parent.matches(CODE_BLOCK_RENDERER_SELECTOR)) return true
  return !!parent.closest(CODE_BLOCK_RENDERER_SELECTOR)
}

/** A whole code fence (`.md-fences`) being added/removed = structural change. */
function isCodeFenceNode(node: Node): boolean {
  return node instanceof Element && node.matches(CODE_BLOCK_RENDERER_SELECTOR)
}

/**
 * Phase 7R.3.4-D / 7R.3.6: classify an editor mutation batch for the reconcile
 * scheduler.
 *   - SELF_ONLY: InkChapter caption decoration mutations.
 *   - RENDERER_ONLY: mutations confined to MathJax OUTPUT nodes. These are
 *     renderer output, NOT new Formula business targets and NOT source edits.
 *   - FORMULA_SOURCE_CHANGED: mutations of the Formula SOURCE (the `<script>`
 *     text inside an `.md-math-block`), which genuinely change Formula TeX.
 *   - FORMULA_STRUCTURE_CHANGED: a genuine logical Formula host (`.md-math-block`)
 *     was added or removed — canonical host-set change, distinct from renderer
 *     output replacement.
 *   - CONTENT_RELEVANT: anything else.
 */
export function classifyEditorMutationBatch(records: MutationRecord[]): EditorMutationClassification {
  const caption = classifyCaptionMutationBatch(records)
  if (caption === 'SELF_ONLY') return 'SELF_ONLY'
  if (records.length === 0) return 'CONTENT_RELEVANT'

  let rendererOnlyCount = 0
  let sourceChangedCount = 0
  let structureChangedCount = 0
  let contentCount = 0

  const inMathSource = (node: Node): boolean => {
    // A characterData mutation targets the script itself (or its text node).
    if (!(node instanceof Element)) {
      const parent = node.parentElement
      return !!parent && parent.tagName === 'SCRIPT' && !!parent.closest('.md-math-block')
    }
    return node.tagName === 'SCRIPT' && !!node.closest('.md-math-block')
  }

  const inRenderer = (node: Node): boolean => {
    return node instanceof Element && !!node.closest(MATH_RENDERER_SELECTOR)
  }

  /** A genuine logical Formula host add/remove (NOT MathJax output inside it). */
  const isFormulaStructureNode = (node: Node): boolean => {
    if (!(node instanceof Element)) return false
    if (node.matches(FORMULA_LOGICAL_HOST_SELECTOR_M)) return true
    // A subtree containing a `.md-math-block` means a whole formula block moved.
    if (node.querySelector(FORMULA_LOGICAL_HOST_SELECTOR_M)) return true
    return false
  }

  for (const record of records) {
    // Character data change: a Formula source edit mutates the <script> text.
    if (record.type === 'characterData') {
      if (inMathSource(record.target)) {
        sourceChangedCount++
        continue
      }
      if (record.target.parentElement?.closest?.(MATH_RENDERER_SELECTOR)) {
        rendererOnlyCount++
        continue
      }
      // Phase 7R.3.9: text inside a code-block renderer (CodeMirror line edits
      // during fence editing) is renderer output, not business content.
      if (inCodeBlockRenderer(record.target)) {
        rendererOnlyCount++
        continue
      }
      contentCount++
      continue
    }

    // ChildList: first check for a genuine Formula host add/remove.
    if (record.type === 'childList') {
      const structural = [...record.addedNodes, ...record.removedNodes].some(n => isFormulaStructureNode(n))
      if (structural) { structureChangedCount++; continue }
    }

    const allRenderer = record.addedNodes.length > 0 || record.removedNodes.length > 0
      ? (() => {
          const nodes = [...record.addedNodes, ...record.removedNodes]
          if (nodes.length === 0) return false
          // A whole code fence being added/removed is structural, never renderer.
          if (nodes.some(n => isCodeFenceNode(n))) return false
          return nodes.every(n => inRenderer(n) || inMathSource(n) || inCodeBlockRenderer(n, record.target))
        })()
      : false

    if (allRenderer) {
      const hasSourceChange = [...record.addedNodes, ...record.removedNodes].some(n => inMathSource(n))
      if (hasSourceChange) sourceChangedCount++
      else rendererOnlyCount++
      continue
    }

    if (record.type === 'childList') {
      const targetElement = record.target instanceof Element ? record.target : null
      const targetInRenderer = targetElement ? !!targetElement.closest(MATH_RENDERER_SELECTOR) : false
      const targetInSource = targetElement ? targetElement.classList.contains('md-math-block') : false
      if (targetInRenderer && !targetInSource) { rendererOnlyCount++; continue }
      if (targetInSource) { sourceChangedCount++; continue }
      // Phase 7R.3.9: childList inside a code-block renderer (target is the
      // fence itself or a node inside it) is renderer-only unless a whole fence
      // node moved. Example: `PRE.md-fences` gets a `DIV.CodeMirror` child.
      if (targetElement && (targetElement.matches(CODE_BLOCK_RENDERER_SELECTOR) || inCodeBlockRenderer(targetElement))) {
        const nodes = [...record.addedNodes, ...record.removedNodes]
        if (nodes.length > 0 && !nodes.some(n => isCodeFenceNode(n)) && nodes.every(n => inCodeBlockRenderer(n, record.target))) {
          rendererOnlyCount++
          continue
        }
      }
    }
    contentCount++
  }

  if (structureChangedCount > 0) return 'FORMULA_STRUCTURE_CHANGED'
  if (sourceChangedCount > 0) return 'FORMULA_SOURCE_CHANGED'
  if (contentCount === 0 && rendererOnlyCount > 0) return 'RENDERER_ONLY'
  if (contentCount > 0) return 'CONTENT_RELEVANT'
  if (rendererOnlyCount > 0) return 'RENDERER_ONLY'
  return 'CONTENT_RELEVANT'
}

/**
 * Phase 7R.3.6-F §17: whether a CONTENT_RELEVANT mutation batch represents a
 * genuine numbering-relevant STRUCTURE change (heading element add/remove/
 * level-change, or a Table/Figure/Code business host add/remove). Pure; used to
 * decide whether to bump the editor structure epoch. Text-only edits
 * (characterData) and MathJax renderer output never count as structure.
 */
export function mutationIndicatesEditorStructureChange(records: MutationRecord[]): boolean {
  const STRUCTURE_HOST_TAGS = new Set(['TABLE', 'THEAD', 'TBODY', 'TFOOT', 'TR', 'TD', 'TH', 'IMG', 'FIGURE', 'PRE', 'BLOCKQUOTE', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6'])
  for (const record of records) {
    if (record.type === 'characterData') continue
    for (const n of [...record.addedNodes, ...record.removedNodes]) {
      if (!(n instanceof Element)) continue
      if (STRUCTURE_HOST_TAGS.has(n.tagName)) return true
      if (n.querySelector('h1,h2,h3,h4,h5,h6,table,img,.md-fences')) return true
    }
  }
  return false
}

/**
 * Phase 7R.3.6-H: canonical Formula host fingerprint — ONLY business host
 * identity/order (tag + class + connected), NEVER MJX-CONTAINER/SVG renderer
 * output. Used to detect a transient host-set replacement during planning.
 */
export function fingerprintFormulaHosts(targets: Array<{ ordinal: number; root: HTMLElement }>): string {
  return targets
    .map(t => {
      let cls = ''
      try { cls = (t.root.getAttribute('class') ?? t.root.className ?? '').toString().slice(0, 60) } catch { /* ignore */ }
      return `${t.ordinal}:${t.root.tagName}.${cls}:${t.root.isConnected ? '1' : '0'}`
    })
    .join('|')
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

export type CaptionPreScanGateVerdict = 'READY' | 'PARK_TRANSITIONAL_MISMATCH' | 'WAIT_HEADING_AUTHORITY'

/**
 * Phase 7R.3.11.7 — PRE-SCAN document-context gate (pure).
 * Runs BEFORE any expensive caption scan (CODE-CANDIDATE-SUMMARY / CAPTION-SCAN
 * / CAPTION-RENDER-PLAN) so a transitional document switch never scans the old
 * context. Only PARK_TRANSITIONAL_MISMATCH blocks; WAIT_HEADING_AUTHORITY is
 * informational (the existing authority gate performs the actual WAIT block).
 */
export function decideCaptionPreScanGate(input: {
  activeDocumentKey: string | null
  coordinatorDocumentKey: string | null
  frameDocumentKey: string | null
  framePresent: boolean
  snapshotDocumentKey: string | null
}): CaptionPreScanGateVerdict {
  const active = input.activeDocumentKey
  const coordinator = input.coordinatorDocumentKey
  if (active && coordinator && active !== coordinator) {
    return 'PARK_TRANSITIONAL_MISMATCH'
  }
  if (active && coordinator && active === coordinator && (!input.framePresent || input.frameDocumentKey !== active)) {
    return 'WAIT_HEADING_AUTHORITY'
  }
  return 'READY'
}

export class CaptionService {
  private registry = new CaptionRegistry()
  private adapter: CaptionDomAdapter
  private formulaAdapter: FormulaNumberingAdapter
  /** Phase 7R.3: single projection authority arbitrator (native-transient plans). */
  private readonly projectionController = new FormulaProjectionController()
  /** Last documentKey for which formula render plans were bound. */
  private lastFormulaProjectionDocKey: string | null = null
  /** Phase 7R.3.2: LIVE hook context — updated on every refresh, read per MathJax call. */
  private hookLiveContext: FormulaProjectionLiveContext = { documentKey: null, controller: this.projectionController, headingSnapshotRevision: null }
  /** Stable provider reference — the hook installs ONCE and reads this live. */
  private hookLiveContextProvider = (): FormulaProjectionLiveContext => this.hookLiveContext
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
  private lastError: string | null = null

  // ── Phase 7R.3.4 performance pipeline ──────────────────────────────
  /** Single reconcile scheduling authority (coalescing + epoch + max-concurrent=1). */
  private readonly reconcileScheduler = new NumberingReconcileScheduler()
  /** One document-open performance transaction per epoch. */
  private readonly perfTracker = new DocumentOpenPerfTracker()
  private documentEpochValue = 0
  /** Last committed heading semantic fingerprint (null → never scanned). */
  private lastHeadingSemanticFingerprint: string | null = null
  /** Last committed canonical object-structure fingerprint. */
  private lastObjectStructureFingerprint: ObjectStructureFingerprint | null = null
  /** Last formula targets (reused by renderer-output verify-only passes). */
  private lastFormulaTargets: FormulaTarget[] = []
  private lastFullScanDocumentKey: string | null = null
  private lastFormulaVerifyReason = ''
  // ── Phase 7R.3.6 snapshot/plan atomicity state ──────────────────────
  /** Monotonic editor structure epoch (Phase 7R.3.6-F §17). */
  private editorStructureEpochValue = 0
  /** Last canonical heading binding generation observed from the resolver session. */
  private lastHeadingBindingGeneration = 0
  /** The LAST COMPLETE Formula plan set (atomic authority, never partial). */
  private lastCompletePlanSet: FormulaCompletePlanSet | null = null
  /** Phase 7R.3.7: LAST COMPLETE caption plan set (atomic authority). */
  private lastCompleteCaptionPlanSet: CaptionCompleteCaptionPlanSet | null = null
  /** Last canonical Formula host fingerprint (transient host-set detection). */
  private lastCanonicalFormulaHostFingerprint = ''
  // ── Phase 7R.3.6 gate counters ──────────────────────────────────────
  private transientCandidateDeferCount = 0
  private transientIncompletePlanPublishCount = 0
  private transientGlobalFallbackProjectionCount = 0
  /** Phase 7R.3.7: caption candidate deferred due to transient unresolved. */
  private captionTransientCandidateDeferCount = 0
  /** Phase 7R.3.7: partial caption plan published (must stay 0). */
  private captionPartialPlanPublishCount = 0
  // ── Phase 7R.3.9 caption deferred hot-loop closure ──────────────────
  /** Deterministic deferred retry state machine (no timers, no self-wake). */
  private captionDeferredRetry = new CaptionDeferredRetryController()
  /** Phase 7R.3.9-DIAG: bounded mutation-source attribution budget. */
  private mutationDiagBudget = 40
  /** Last reported failure signature (state dedup for detailed forensic). */
  private lastReportedCaptionFailureSignature = ''
  /** Phase 7R.3.9 counters exposed through the gate report. */
  private captionParkedStateSelfWakeCount = 0
  private captionHotLoopGuardTriggeredCount = 0
  private captionCanonicalInvariantFailureCount = 0
  private captionDeferredTimerPollingCount = 0
  private captionFollowUpCount = 0
  private captionReconcileInitialCount = 0
  private captionReconcileFollowUpCount = 0
  // ── Phase 7R.3.9R caption heading authority gate ───────────────────
  /** Pre-authority barrier: Caption must not scan/resolve/retry before the
   *  committed CanonicalHeadingFrame exists for the active document. */
  private captionAuthorityGate = new CaptionHeadingAuthorityGate()
  /** Last CAPTION-HEADING-AUTHORITY-GATE audit signature (bounded output). */
  private lastCaptionAuthorityGateAuditSignature = ''

  // Phase 7R.3.11.7 — pre-scan document-context gate counters.
  private captionPreScanGateCheckCount = 0
  private captionPreScanTransitionalParkCount = 0
  private captionPreScanWaitHeadingCount = 0
  private lastPreScanVerdictSignature = ''
  /** Phase 7R.3.9R pre-authority counters (must stay 0 in a healthy session). */
  private livePlanCountZeroWithoutFormulaDeleteCount = 0
  private livePlanCountPartialWithoutFormulaStructureChangeCount = 0
  private historicalSignatureReactivationBlockCount = 0
  private skippedSameSignatureBudgetExhaustedCount = 0
  private formulaRenderLoopCount = 0
  private visibleExactMatchWithNullCommitStateCount = 0
  private previousSignatureNullOnNonInitialTransitionCount = 0
  private formulaStuckAfterRepeatedToggleCount = 0
  private captionMutationSelfIgnoredCount = 0
  private captionMutationContentRefreshCount = 0
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
    this.ctx = ctx
    this.adapter = new CaptionDomAdapter(() => this.currentEditorRoot)
    this.formulaAdapter = new FormulaNumberingAdapter(() => this.currentEditorRoot)
    // Phase 7R.3.4-B: ONE scheduling authority. The executor runs the coalesced
    // reconcile (fast-path gate + stale-transaction abort inside the executor).
    this.reconcileScheduler.attach(pending => this.performNumberingReconcile(pending))
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
    const mode = this.formulaConfig.formulaMode ?? 'typora-native'
    console.info(
      `[InkChapter Numbering] FORMULA-MODE-SWITCH mode=${mode} ` +
      `enabled=${this.formulaConfig.enabled} prefix=${JSON.stringify(this.formulaConfig.prefix)} ` +
      `numberingMode=${this.formulaConfig.numberingMode} template=${JSON.stringify(this.formulaConfig.template)} decision=APPLIED`,
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
    if (this.started) return
    this.started = true

    console.info('[InkChapter Caption] SERVICE-START')
    emitRuntimeAudit('CAPTION-SERVICE-START', { decision: 'STARTED' })

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

    // Phase 7R.3.9R: subscribe to the canonical heading frame authority BEFORE
    // the first document-open reconcile. emitCurrent=true replays the current
    // committed frame (catch-up), so a frame commit that raced our subscription
    // is never missed → the WAITING→READY release always fires exactly once.
    if (this.ctx.subscribeCanonicalHeadingFrame) {
      this.disposers.push(this.ctx.subscribeCanonicalHeadingFrame((frame) => {
        this.handleCanonicalFrameCommitted(frame)
      }, { emitCurrent: true }))
    }

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
    this.requestNumberingReconcile({
      reason: `bind:${reason}`,
      invalidation: ['DOCUMENT_IDENTITY_CHANGED', 'OBJECT_STRUCTURE_CHANGED', 'HEADING_SEMANTICS_CHANGED'],
    })
  }

  private onDocumentChanged(): void {
    const docKey = this.ctx.getDocumentKey?.() ?? this.ctx.getActiveFilePath?.() ?? null
    const changed = docKey !== this.currentDocumentKey

    if (changed && this.currentDocumentKey !== null) {
      // Document switch: flush old document bindings (persisted already).
      this.flushDocument()
    }
    this.currentDocumentKey = docKey
    // Phase 7R.3.4-A: a document open/switch begins a NEW perf epoch ONLY when
    // the document identity actually changes (avoids fragmenting one open).
    if (changed || this.documentEpochValue === 0) {
      this.documentEpochValue = this.perfTracker.beginEpoch(docKey)
      registerActivePerfTracker(this.perfTracker)
      this.projectionController.clearAll()
      this.lastHeadingSemanticFingerprint = null
      this.lastObjectStructureFingerprint = null
      this.lastFormulaTargets = []
      this.lastFullScanDocumentKey = null
      // Phase 7R.3.6-F: document switch is a genuine structure change → bump the
      // editor structure epoch; the previous document's COMPLETE plan set is
      // no longer authoritative.
      this.editorStructureEpochValue++
      this.lastCompletePlanSet = null
      this.lastCanonicalFormulaHostFingerprint = ''
      this.lastHeadingBindingGeneration = 0
      // Phase 7R.3.9: document switch clears deferred retry state and the
      // previous document's COMPLETE caption plan (never project doc A into B).
      this.captionDeferredRetry.resetForDocument()
      this.lastCompleteCaptionPlanSet = null
      this.lastReportedCaptionFailureSignature = ''
      // Phase 7R.3.9R: clear A's pending intent + authority state; B starts
      // WAITING_FOR_HEADING_AUTHORITY until B's committed frame releases it.
      this.captionAuthorityGate.resetForDocumentSwitch(docKey)
    }
    if (docKey && this.currentEditorRoot) this.perfTracker.mark('T1')
    this.rehydrate()
    this.requestNumberingReconcile({
      reason: 'document-open',
      invalidation: ['DOCUMENT_IDENTITY_CHANGED', 'HEADING_SEMANTICS_CHANGED', 'OBJECT_STRUCTURE_CHANGED'],
    })
  }

  private flushDocument(): void {
    this.boundTargets.clear()
    this.orphanIds.clear()
  }

  private connectObserver(root: HTMLElement): void {
    this.disconnectObserver()
    this.mutationObserver = new MutationObserver((records) => {
      if (this.rendering) return
      const classification = classifyEditorMutationBatch(records)
      if (classification === 'SELF_ONLY') {
        this.captionMutationSelfIgnoredCount++
        this.perfTracker.incSelfMutationSkip()
        return
      }
      // Phase 7R.3.9: bounded mutation-source attribution budget. Verbose-only
      // (a real content mutation is rare after the CodeMirror fix; this helps
      // attribute any future feedback loop without flooding normal logs).
      if (this.mutationDiagBudget > 0 && classification !== 'RENDERER_ONLY' && forensicVerboseEnabled()) {
        this.mutationDiagBudget--
        emitRuntimeAudit('MUTATION-SOURCE-DIAG', {
          classification,
          recordCount: records.length,
          samples: records.slice(0, 5).map(r => ({
            type: r.type,
            targetTag: r.target instanceof Element ? r.target.tagName : r.target.nodeName,
            targetClass: r.target instanceof Element ? String(r.target.className || '').slice(0, 70) : '',
            targetId: r.target instanceof Element ? r.target.id : '',
            addedCount: r.addedNodes.length,
            removedCount: r.removedNodes.length,
            addedTags: [...r.addedNodes].slice(0, 3).map(n => (n instanceof Element ? n.tagName + '.' + String(n.className || '').slice(0, 30) : n.nodeName)),
            removedTags: [...r.removedNodes].slice(0, 3).map(n => (n instanceof Element ? n.tagName + '.' + String(n.className || '').slice(0, 30) : n.nodeName)),
          })),
        })
      }
      this.captionMutationContentRefreshCount++
      // Phase 7R.3.6-F §17: bump the editor structure epoch ONLY for genuine
      // numbering-relevant structure changes (heading/Formula/object host
      // add/remove/level-change). Renderer output and caption/self mutations
      // never bump it.
      if (classification === 'FORMULA_STRUCTURE_CHANGED') {
        this.editorStructureEpochValue++
      } else if (classification === 'CONTENT_RELEVANT' && mutationIndicatesEditorStructureChange(records)) {
        this.editorStructureEpochValue++
      }
      // Phase 7R.3.4-B/D: map the mutation class onto reconcile invalidation.
      const invalidation: ReconcileInvalidationKey[] =
        classification === 'RENDERER_ONLY' ? ['RENDERER_OUTPUT_CHANGED']
          : classification === 'FORMULA_SOURCE_CHANGED' ? ['FORMULA_SOURCE_CHANGED']
          : classification === 'FORMULA_STRUCTURE_CHANGED' ? ['FORMULA_STRUCTURE_CHANGED', 'OBJECT_STRUCTURE_CHANGED']
          : ['HEADING_SEMANTICS_CHANGED', 'OBJECT_STRUCTURE_CHANGED']
      this.requestNumberingReconcile({ reason: `mutation:${classification}`, invalidation })
    })
    this.mutationObserver.observe(root, { childList: true, subtree: true })
  }

  private disconnectObserver(): void {
    this.mutationObserver?.disconnect()
    this.mutationObserver = null
  }

  /**
   * Phase 7R.3.4-B: THE single production scheduling entry for numbering
   * recompute. Coalesces same-epoch requests into ONE executor run.
   */
  requestNumberingReconcile(input: {
    reason: string
    invalidation: ReconcileInvalidationKey | ReconcileInvalidationKey[]
    documentEpoch?: number
    documentKey?: string | null
  }): void {
    this.perfTracker.incCoordinatorSchedule()
    this.reconcileScheduler.request({
      reason: input.reason,
      invalidation: input.invalidation,
      documentEpoch: input.documentEpoch ?? this.documentEpochValue,
      documentKey: input.documentKey !== undefined ? input.documentKey : this.currentDocumentKey,
    })
  }

  /**
   * Phase 7R.3.9R: current heading-authority readiness for the ACTIVE document.
   * READY ⇔ committed CanonicalHeadingFrame exists AND frame.documentKey matches
   * the active document. A committed empty frame (0 headings) is READY.
   */
  private resolveCaptionHeadingAuthorityReadiness(): CaptionHeadingAuthorityState {
    const docKey = this.currentDocumentKey ?? null
    const frame = this.ctx.getCanonicalHeadingFrame?.() ?? null
    return resolveCaptionHeadingAuthority(docKey, frame)
  }

  /**
   * Phase 7R.3.9R: canonical frame COMMIT is the single release authority.
   * WAITING_FOR_HEADING_AUTHORITY → READY → ONE coalesced current-state reconcile.
   */
  private handleCanonicalFrameCommitted(frame: CanonicalHeadingFrame | null): void {
    let targetKey = this.currentDocumentKey ?? null
    if (!targetKey) {
      // The Heading frame can commit BEFORE the Caption document context is
      // wired (Typora renders headings ahead of the file:open leaf event). Fall
      // back to the gate's WAITING document key / pending intent so the release
      // is never lost to a docKey race.
      const st = this.captionAuthorityGate.getState()
      if (st.state === 'WAITING_FOR_HEADING_AUTHORITY') {
        targetKey = st.documentKey
      } else {
        const pi = this.captionAuthorityGate.getPendingIntent()
        if (pi) targetKey = pi.documentKey || null
      }
    }
    if (!targetKey) {
      this.captionAuthorityGate.resetForNoDocument()
      return
    }
    const release = this.captionAuthorityGate.onFrameCommitted(frame, targetKey)
    if (release.decision === 'RELEASED_ONE_RECONCILE' && release.intent) {
      const readyState = this.captionAuthorityGate.getState()
      this.lastCaptionAuthorityGateAuditSignature = ''
      emitRuntimeAudit('CAPTION-AUTHORITY-READY-RELEASE', {
        documentKey: targetKey,
        semanticRevision: readyState.state === 'READY' ? readyState.semanticRevision : -1,
        frameGeneration: readyState.state === 'READY' ? readyState.frameGeneration : -1,
        frameFingerprint: readyState.state === 'READY' ? readyState.frameFingerprint : '',
        coalescedReasonCount: release.intent.reasons.size,
        coalescedReasons: [...release.intent.reasons],
        scheduledReconcileCount: 1,
        decision: 'RELEASE_ONE_RECONCILE',
      })
      // ONE coalesced reconcile with the merged invalidation mask. The scheduler
      // coalesces any concurrent requests, so this is exactly one full scan.
      const mask = release.intent.invalidationMask
      const keys = (Object.keys(RECONCILE_INVALIDATION) as (keyof typeof RECONCILE_INVALIDATION)[])
        .filter(k => (mask & RECONCILE_INVALIDATION[k]) !== 0)
      this.requestNumberingReconcile({
        reason: 'authority-ready-release',
        invalidation: keys.length > 0 ? keys : ['HEADING_SEMANTICS_CHANGED', 'OBJECT_STRUCTURE_CHANGED'],
      })
    }
  }

  /**
   * Phase 7R.3.11.7 — PRE-SCAN document-context gate. Called at the earliest
   * point of every refresh/reconcile, BEFORE collectTargets / CODE candidate
   * scan / full scan / plan build. During a transitional document switch
   * (activeDocumentKey changed but caption/coordinator still on the old key)
   * it PARKS with zero scans. WAIT_HEADING_AUTHORITY is informational only —
   * the existing authority gate performs the actual WAIT block.
   */
  private gateCaptionPreScanDocumentContext(reason: string): boolean {
    const activeKey = this.ctx.getDocumentKey?.() ?? null
    const coordinatorKey = this.currentDocumentKey ?? null
    const frame = this.ctx.getCanonicalHeadingFrame?.() ?? null
    const snapshot = this.ctx.getHeadingNumberingSnapshot?.() ?? null
    this.captionPreScanGateCheckCount++
    const verdict = decideCaptionPreScanGate({
      activeDocumentKey: activeKey,
      coordinatorDocumentKey: coordinatorKey,
      frameDocumentKey: frame?.documentKey ?? null,
      framePresent: frame !== null,
      snapshotDocumentKey: snapshot?.documentKey ?? null,
    })
    if (verdict === 'PARK_TRANSITIONAL_MISMATCH') this.captionPreScanTransitionalParkCount++
    if (verdict === 'WAIT_HEADING_AUTHORITY') this.captionPreScanWaitHeadingCount++

    const signature = `${verdict}|${activeKey ?? ''}|${coordinatorKey ?? ''}`
    if (signature !== this.lastPreScanVerdictSignature || verdict === 'PARK_TRANSITIONAL_MISMATCH') {
      this.lastPreScanVerdictSignature = signature
      emitRuntimeAudit('CAPTION-PRE-SCAN-DOCUMENT-GATE', {
        triggerReason: reason,
        activeDocumentKey: activeKey ?? null,
        captionDocumentKey: coordinatorKey,
        coordinatorDocumentKey: coordinatorKey,
        framePresent: frame !== null,
        frameDocumentKey: frame?.documentKey ?? null,
        snapshotPresent: snapshot !== null,
        snapshotDocumentKey: snapshot?.documentKey ?? null,
        decision: verdict,
      })
    }
    return verdict !== 'PARK_TRANSITIONAL_MISMATCH'
  }

  /** Phase 7R.3.11.7 — pre-scan gate counters (read-only). */
  getCaptionPreScanGateCounters(): {
    checkCount: number
    transitionalParkCount: number
    waitHeadingCount: number
  } {
    return {
      checkCount: this.captionPreScanGateCheckCount,
      transitionalParkCount: this.captionPreScanTransitionalParkCount,
      waitHeadingCount: this.captionPreScanWaitHeadingCount,
    }
  }

  /**
   * Phase 7R.3.9R: pre-authority gate — called at the earliest safe point of
   * every Caption reconcile/refresh, BEFORE collectTargets / CODE candidate scan
   * / resolver batch / plan build / retry state machine / PARK / hot-loop fuse /
   * projection writes. Non-READY states record ONE coalesced pending intent and
   * return false (the caller must not run the expensive pipeline).
   */
  private gateCaptionReconcileBeforeAuthority(
    reason: string,
    invalidationMask: number,
  ): boolean {
    const docKey = this.currentDocumentKey ?? null
    const frame = this.ctx.getCanonicalHeadingFrame?.() ?? null
    const decision = this.captionAuthorityGate.decide(docKey, frame, reason, invalidationMask)
    const st = decision.state
    const allowed = decision.decision === 'READY' || decision.decision === 'RELEASED_ONE_RECONCILE'

    // Phase 7R.3.9R: a first READY transition releases the ONE coalesced
    // initial reconcile. Emit the dedicated release marker once.
    if (decision.decision === 'RELEASED_ONE_RECONCILE' && decision.intent) {
      this.lastCaptionAuthorityGateAuditSignature = ''
      emitRuntimeAudit('CAPTION-AUTHORITY-READY-RELEASE', {
        documentKey: docKey,
        semanticRevision: st.state === 'READY' ? st.semanticRevision : -1,
        frameGeneration: st.state === 'READY' ? st.frameGeneration : -1,
        frameFingerprint: st.state === 'READY' ? st.frameFingerprint : '',
        coalescedReasonCount: decision.intent.reasons.size,
        coalescedReasons: [...decision.intent.reasons],
        scheduledReconcileCount: 1,
        decision: 'RELEASE_ONE_RECONCILE',
      })
    }

    // Bounded authority-gate audit: emit on every transition / release / wait
    // start, dedup consecutive identical WAITs for the same state.
    const signature = `${st.state}|${st.state === 'READY' ? st.documentKey : ''}|${allowed ? 'READY' : 'WAIT'}`
    if (signature !== this.lastCaptionAuthorityGateAuditSignature || decision.decision !== 'WAIT') {
      this.lastCaptionAuthorityGateAuditSignature = signature
      const pending = this.captionAuthorityGate.getPendingIntent()
      const counters = this.captionAuthorityGate.getCounters()
      emitRuntimeAudit('CAPTION-HEADING-AUTHORITY-GATE', {
        activeDocumentKey: docKey,
        captionDocumentKey: this.currentDocumentKey ?? null,
        framePresent: frame !== null,
        frameDocumentKey: frame?.documentKey ?? null,
        semanticRevision: st.state === 'READY' ? st.semanticRevision : -1,
        frameGeneration: st.state === 'READY' ? st.frameGeneration : -1,
        state: st.state,
        triggerReason: reason,
        pendingReasonCount: pending ? pending.reasons.size : 0,
        pendingReasons: pending ? [...pending.reasons].slice(0, 8) : [],
        expensiveScanAllowed: allowed,
        retryBudgetConsumed: false,
        decision: allowed ? (decision.decision === 'RELEASED_ONE_RECONCILE' ? 'RELEASE_ONE_RECONCILE' : 'READY') : (decision.decision === 'NO_DOCUMENT' ? 'RESET_DOCUMENT_SWITCH' : 'WAIT'),
        preauth: {
          PREAUTH_CAPTION_RECONCILE_REQUEST_COUNT: counters.preAuthReconcileRequestCount,
          PREAUTH_CAPTION_FULL_SCAN_COUNT: counters.preAuthFullScanCount,
          PREAUTH_CAPTION_TARGET_DISCOVERY_COUNT: counters.preAuthTargetDiscoveryCount,
          PREAUTH_CAPTION_PLAN_BUILD_COUNT: counters.preAuthPlanBuildCount,
          PREAUTH_RETRY_BUDGET_CONSUME_COUNT: counters.preAuthRetryBudgetConsumeCount,
          PREAUTH_CAPTION_PARK_COUNT: counters.preAuthParkCount,
          PREAUTH_HOT_LOOP_GUARD_TRIGGER_COUNT: counters.preAuthHotLoopGuardTriggerCount,
          PREAUTH_CANONICAL_HOST_SET_TRANSIENT_TARGET_COUNT: counters.preAuthCanonicalHostSetTransientTargetCount,
          AUTHORITY_WAIT_TRIGGER_COUNT: counters.authorityWaitTriggerCount,
          AUTHORITY_READY_RELEASE_COUNT: counters.authorityReadyReleaseCount,
          AUTHORITY_READY_RELEASE_RECONCILE_COUNT: counters.authorityReadyReleaseReconcileCount,
        },
      })
    }

    if (!allowed) {
      // The retry machine must never see a pre-authority request; all prevented
      // work is counted inside the gate (healthy sessions keep these at 0).
      // No retry budget / PARK / hot-loop fuse / scan was consumed here.
      return false
    }
    return allowed
  }

  /**
   * Phase 7R.3.4-B/C: the coalesced reconcile executor.
   *   - ABORT_STALE_TRANSACTION: epoch/document changed before execution.
   *   - CAPTION-HEADING-AUTHORITY-GATE (Phase 7R.3.9R): before any expensive
   *     work, require a READY heading authority for the active document.
   *   - SEMANTIC_NOOP fast path: structural invalidation absent + heading
   *     semantic fingerprint unchanged → skip the full caption/formula scan.
   *   - RENDERER_OUTPUT_CHANGED: skip the full scan but still run the Formula
   *     visible verify on the cached targets (renderer-integrity check).
   */
  private performNumberingReconcile(pending: PendingNumberingReconcile): void {
    this.perfTracker.incCoordinatorExecution()
    const liveEpoch = this.documentEpochValue
    const liveDocKey = this.currentDocumentKey ?? null
    if (pending.documentEpoch !== liveEpoch || (pending.documentKey && pending.documentKey !== liveDocKey)) {
      emitRuntimeAudit('NUMBERING-RECONCILE-STALE-ABORT', {
        requestedEpoch: pending.documentEpoch,
        liveEpoch,
        requestedDocumentKey: pending.documentKey,
        liveDocumentKey: liveDocKey,
        projectionWrites: 0,
        decision: 'ABORT_STALE_TRANSACTION',
      })
      return
    }

    // Phase 7R.3.11.7: PRE-SCAN document-context gate at the reconcile ENTRY,
    // BEFORE the authority gate / semantic fingerprint / any expensive scan.
    // A transitional document switch (active changed, caption/coordinator still
    // old) parks with zero scans and must not touch fingerprint state.
    const reasons = Array.from(pending.reasons)
    if (!this.gateCaptionPreScanDocumentContext(reasons.join('+') || 'reconcile')) {
      return
    }
    // Phase 7R.3.9R: heading-authority barrier BEFORE collectTargets/resolver/
    // retry. WAITING → record ONE coalesced pending intent → return.
    if (!this.gateCaptionReconcileBeforeAuthority(reasons.join('+') || 'reconcile', pending.invalidationMask)) {
      return
    }

    const structuralMask = pending.invalidationMask & SEMANTIC_STRUCTURAL_INVALIDATION_MASK
    const snapshot = this.ctx.getHeadingNumberingSnapshot?.() ?? null
    const fp = computeHeadingSemanticFingerprint(snapshot)

    if (structuralMask === 0 && this.lastHeadingSemanticFingerprint !== null && fp !== '' && fp === this.lastHeadingSemanticFingerprint) {
      // Early semantic no-op — no structural invalidation and the canonical
      // heading semantics are unchanged.
      this.perfTracker.incSemanticNoopSkip()
      emitRuntimeAudit('NUMBERING-RECONCILE-FAST-PATH', {
        decision: 'SEMANTIC_NOOP',
        documentEpoch: liveEpoch,
        documentKey: liveDocKey,
        invalidationMask: pending.invalidationMask,
        reasons: Array.from(pending.reasons),
        fullCaptionScan: 0,
        formulaPlanBuild: 0,
        formulaVisibleForensic: 0,
      })
      // Renderer output still warrants a cheap Formula visible verify (unchanged
      // plans, exact-token check on the cached targets).
      if ((pending.invalidationMask & 1 << 5) !== 0 && this.lastFormulaTargets.length > 0) {
        this.runFormulaVisibleVerifyOnly(liveDocKey)
      }
      return
    }

    this.lastHeadingSemanticFingerprint = fp
    this.refresh(Array.from(pending.reasons).join('+') || 'reconcile', pending.invalidationMask)
  }

  /** Verify-only pass over cached formula targets (no caption scan, no rerender). */
  private runFormulaVisibleVerifyOnly(documentKey: string | null): void {
    if (!documentKey || this.lastFormulaTargets.length === 0) return
    const snapshot = this.ctx.getHeadingNumberingSnapshot?.() ?? null
    if (!snapshot || snapshot.documentKey !== documentKey) return
    const items: FormulaReconcileItem[] = this.lastFormulaTargets.map(t => {
      const plan = this.projectionController.getPlan(t.root)
      return { target: t, renderedNumber: plan?.renderedNumber ?? '', label: plan?.renderedNumber ?? '', mode: 'inkchapter', enabled: true }
    })
    this.emitVisibleProjectionForensic(snapshot, this.lastFormulaTargets, items, 'inkchapter')
    this.perfTracker.incFormulaVisibleVerify()
  }

  private scheduleRefresh(): void {
    // Phase 7R.3.4-B: legacy alias — all scheduling funnels through the single
    // coalescing authority (microtask, no debounce).
    this.requestNumberingReconcile({ reason: this.lastRefreshReason || 'schedule-refresh', invalidation: ['HEADING_SEMANTICS_CHANGED', 'OBJECT_STRUCTURE_CHANGED'] })
  }

  dispose(): void {
    this.disconnectObserver()
    for (const d of this.disposers) { try { d() } catch { /* ignore */ } }
    this.disposers = []
    if (this.refreshTimer !== null) { clearTimeout(this.refreshTimer); this.refreshTimer = null }
    this.reconcileScheduler.dispose()
    this.projectionController.clearAll()
    this.lastFormulaProjectionDocKey = null
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
  refresh(reason = 'manual', invalidationMask = SEMANTIC_STRUCTURAL_INVALIDATION_MASK): void {
    this.lastRefreshReason = reason
    const docKey = this.currentDocumentKey
    const editorRoot = this.currentEditorRoot

    if (!docKey) { this.adapter.clearAllCaptions(); this.formulaAdapter.clearAll(); return }
    // Phase 7R.3.11.7: PRE-SCAN document-context gate FIRST (before the
    // authority gate): a transitional document switch parks with zero scans.
    if (!this.gateCaptionPreScanDocumentContext(reason)) {
      return
    }
    // Phase 7R.3.9R: belt-and-braces authority gate for DIRECT refresh() callers
    // (applySettings / setCaption / rehydrate-empty / force-refresh). Same
    // guarantee as the scheduler path: no collectTargets before heading READY.
    if (!this.gateCaptionReconcileBeforeAuthority(reason, invalidationMask)) {
      return
    }
    const documentRawTables = document.querySelectorAll('table').length
    const documentRawImages = document.querySelectorAll('img').length
    const documentRawPres = document.querySelectorAll('pre').length
    const editorRawTables = editorRoot ? editorRoot.querySelectorAll('table').length : 0
    const editorRawImages = editorRoot ? editorRoot.querySelectorAll('img').length : 0
    const editorRawPres = editorRoot ? editorRoot.querySelectorAll('pre').length : 0
    // Phase 7R.3.4-A: this is a full pipeline scan (only reached past the fast path).
    this.perfTracker.incFullCaptionScan()
    this.perfTracker.mark('T1')
    this.lastFullScanDocumentKey = docKey

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

      // Phase 7R.3.9: per-target success detail is VERBOSE-ONLY (large documents
      // must not emit one record per target on every reconcile).
      if (forensicVerboseEnabled()) {
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
      }

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

    // Phase 6.1R: compute Figure/Table/Code desired numbers from the canonical
    // HeadingNumberingSnapshot via identity-based binding — never raw DOM index.
    // Document-context coherence gate: only project when all document keys agree.
    const activeDocumentKey = this.ctx.getDocumentKey?.() ?? null
    const snapshot = this.ctx.getHeadingNumberingSnapshot?.() ?? null

    const snapshotDocumentKey = snapshot?.documentKey ?? 'none'
    const coordinatorDocumentKey = docKey ?? 'none'
    // Aligned = active and caption belong to the same document; when a heading
    // snapshot IS present it must belong to the same document too (snapshot-less
    // projection is allowed → GLOBAL fallback, never a mixed document).
    const contextAligned = !!activeDocumentKey
      && activeDocumentKey === coordinatorDocumentKey
      && (!snapshot || activeDocumentKey === snapshotDocumentKey)

    emitRuntimeAudit('CAPTION-DOCUMENT-CONTEXT-FORENSIC', {
      activeDocumentKey: activeDocumentKey ?? 'none',
      captionDocumentKey: coordinatorDocumentKey,
      snapshotDocumentKey,
      coordinatorDocumentKey,
      snapshotRevision: snapshot?.revision ?? -1,
      decision: contextAligned ? 'ALIGNED' : 'DEFER_MISMATCH',
    })

    if (!contextAligned) {
      // Never project mixed-document state: defer, zero DOM projection writes.
      emitRuntimeAudit('CAPTION-DEFER-DOCUMENT-MISMATCH', {
        activeDocumentKey: activeDocumentKey ?? 'none',
        captionDocumentKey: coordinatorDocumentKey,
        snapshotDocumentKey,
        projectionWrites: 0,
      })
      return
    }

    // Phase 7R.3.4-E / 7R.3.6-G: ONE resolver session per reconcile — collect
    // canonical heading bindings once, bind ALL object targets in one forward
    // sweep with an explicit bound/unbound outcome per target.
    this.perfTracker.mark('T2')
    let batchResolved: Array<
      | {
          bound: true
          documentKey: string
          revision: number
          headingStableIdentity: string
          semanticState: import('./semantic-heading-types').SemanticHeadingNumberState
        }
      | { bound: false; reason: string; candidateStableIdentity?: string }
    > | null = null
    if (this.ctx.resolvePrecedingSemanticHeadingBatch) {
      batchResolved = this.ctx.resolvePrecedingSemanticHeadingBatch(plan.map(item => item.target.root))
    }

    // ── Phase 7R.3.7: EXPLICIT per-target semantic resolution (shared contract
    //    with Formula). Every caption target gets an explicit outcome:
    //    BOUND / LEGITIMATE_CHAPTER_FALLBACK / LEGITIMATE_GLOBAL_FALLBACK /
    //    TRANSIENT_UNRESOLVED. CANDIDATE_IDENTITY_MISSING and every other
    //    transient incoherence NEVER become a fake GLOBAL caption.
    //    Phase 7R.3.9: normal mode keeps this forensic VERBOSE-ONLY (large
    //    documents must not emit one record per target on every reconcile). ──
    const captionMissingIdentities: string[] = []
    const captionResolutions: FormulaSemanticResolution[] = plan.map((item, i) => {
      const raw = batchResolved !== null
        ? batchResolved[i]
        : (() => {
            const single = this.ctx.resolvePrecedingSemanticHeading?.(item.target.root) ?? null
            return single
              ? { bound: true as const, documentKey: single.documentKey, revision: single.revision, headingStableIdentity: single.headingStableIdentity, semanticState: single.semanticState }
              : { bound: false as const, reason: 'NO_PRECEDING_HEADING' }
          })()
      const res = classifyFormulaSemanticResolution(
        raw.bound,
        raw.bound ? null : raw.reason,
        raw.bound ? raw.headingStableIdentity : null,
        raw.bound ? raw.semanticState : null,
      )
      if (!raw.bound && (raw as { candidateStableIdentity?: string }).candidateStableIdentity) {
        captionMissingIdentities.push((raw as { candidateStableIdentity: string }).candidateStableIdentity)
      }
      if (forensicVerboseEnabled()) {
        emitRuntimeAudit('CAPTION-HEADING-BINDING-FORENSIC', {
          targetType: item.type,
          resolvedHeadingStableIdentity: raw.bound ? raw.headingStableIdentity : 'none',
          resolvedChapterOrdinal: raw.bound ? raw.semanticState.chapterOrdinal : null,
          resolvedSectionOrdinal: raw.bound ? raw.semanticState.sectionOrdinal : null,
          resolvedRevision: raw.bound ? raw.revision : -1,
          decision: res.decision,
          transientReason: res.decision === 'TRANSIENT_UNRESOLVED' ? res.reason : null,
        })
      }
      return res
    })
    this.perfTracker.mark('T3')

    const productionConfigs: ProductionObjectConfigs = {
      figure: migrateObjectNumberingConfig('figure', resolveCaptionTypeSettings(this.captionSettings, 'figure')),
      table: migrateObjectNumberingConfig('table', resolveCaptionTypeSettings(this.captionSettings, 'table')),
      code: migrateObjectNumberingConfig('code', resolveCaptionTypeSettings(this.captionSettings, 'code')),
    }

    // ── Caption plan-set candidate coherence + ATOMIC publication ────────
    // A COMPLETE candidate publishes atomically. Any TRANSIENT_UNRESOLVED
    // target DEFERS the whole candidate and keeps the previous COMPLETE caption
    // plan visible (projectionWrites=0). A LEGITIMATE_GLOBAL resolution (e.g.
    // genuinely before the first heading) still publishes GLOBAL.
    const transientUnresolvedCount = captionResolutions.filter(r => r.decision === 'TRANSIENT_UNRESOLVED').length
    const resolvedCount = captionResolutions.filter(isResolvedFormulaSemantic).length
    const legitimateChapterFallbackCount = captionResolutions.filter(r => r.decision === 'LEGITIMATE_CHAPTER_FALLBACK').length
    const legitimateGlobalFallbackCount = captionResolutions.filter(r => r.decision === 'LEGITIMATE_GLOBAL_FALLBACK').length
    const captionDecision: CaptionCandidateCoherenceDecision =
      transientUnresolvedCount > 0 ? 'DEFER_TRANSIENT_UNRESOLVED' : 'COMPLETE'

    this.emitCaptionCandidateCoherence(snapshot, plan.length, resolvedCount, legitimateChapterFallbackCount, legitimateGlobalFallbackCount, transientUnresolvedCount, captionDecision)

    if (captionDecision !== 'COMPLETE') {
      // ── Phase 7R.3.9: bounded deferred retry state machine ──────────────
      // KEEP_PREVIOUS_COMPLETE_SET + projectionWrites=0 ALWAYS. The retry is
      // EVENT-DRIVEN (one coalesced follow-up max) and never self-wakes a
      // parked state. No setTimeout / polling exists in this path.
      this.captionTransientCandidateDeferCount++
      const previous = this.lastCompleteCaptionPlanSet
      const publishedPlanCount = previous ? previous.states.length : 0
      const stateToken = this.computeCaptionStateToken(snapshot, plan)
      const reasonCounts = new Map<string, number>()
      for (const r of captionResolutions) {
        if (r.decision !== 'TRANSIENT_UNRESOLVED') continue
        reasonCounts.set(r.reason, (reasonCounts.get(r.reason) ?? 0) + 1)
      }
      const reasonFingerprint = fastHash([...reasonCounts.keys()].sort().join('|'))
      const uniqueMissingIdentities = [...new Set(captionMissingIdentities)].sort()
      const identityFingerprint = fastHash(uniqueMissingIdentities.join('|'))
      const failureSignature = buildCaptionFailureSignature(stateToken, transientUnresolvedCount, reasonFingerprint, identityFingerprint)

      this.captionDeferredRetry.recordFullReconcile(stateToken, failureSignature)
      const retryDecision = this.captionDeferredRetry.decide(stateToken, failureSignature)

      // ONE unresolved summary per distinct failure signature (state dedup).
      this.emitCaptionUnresolvedSummary(snapshot, stateToken, transientUnresolvedCount, reasonCounts, uniqueMissingIdentities, failureSignature, captionMissingIdentities)

      if (retryDecision === 'HOT_LOOP_FUSE_PARK') this.captionHotLoopGuardTriggeredCount++
      if (retryDecision === 'IGNORE_PARKED_SAME_STATE') this.captionParkedStateSelfWakeCount++
      if (retryDecision === 'ALLOW_ONE_FOLLOW_UP') this.captionReconcileFollowUpCount++

      const retryState = retryDecision === 'ALLOW_ONE_FOLLOW_UP' ? 'FOLLOW_UP_ALLOWED' : 'PARKED'
      emitRuntimeAudit('CAPTION-PLAN-SET-PUBLISH', {
        documentKey: snapshot?.documentKey ?? this.currentDocumentKey ?? null,
        snapshotRevision: snapshot?.revision ?? -1,
        editorStructureEpoch: this.editorStructureEpochValue,
        headingBindingGeneration: this.ctx.getHeadingBindingGeneration?.() ?? this.lastHeadingBindingGeneration,
        previousCompletePlanCount: publishedPlanCount,
        candidatePlanCount: 0,
        publishedPlanCount,
        canonicalTargetCount: plan.length,
        decision: 'DEFER_KEEP_PREVIOUS_COMPLETE_SET',
        transientUnresolvedCount,
        retryState,
        retryDecision,
        stateToken,
        projectionWrites: 0,
      })

      // Persistent identity mismatch → CANONICAL_INVARIANT_FAILURE (never an
      // endless transient). KEEP_PREVIOUS_COMPLETE_SET, projectionWrites=0,
      // PARK, ONE targeted forensic — no further retry.
      const allInvariantReasons = [...reasonCounts.keys()].every(r =>
        r === 'CANDIDATE_IDENTITY_MISSING' || r === 'BINDING_IDENTITY_NOT_IN_SEMANTIC_SET' || r === 'DUPLICATE_HEADING_IDENTITY')
      const isPersistentInvariant = allInvariantReasons && (retryDecision === 'PARK' || retryDecision === 'HOT_LOOP_FUSE_PARK')
      if (isPersistentInvariant) {
        this.captionCanonicalInvariantFailureCount++
        emitRuntimeAudit('CAPTION-CANONICAL-INVARIANT-FAILURE', {
          documentKey: snapshot?.documentKey ?? this.currentDocumentKey ?? null,
          stateToken,
          unresolvedTargetCount: transientUnresolvedCount,
          uniqueMissingIdentityCount: uniqueMissingIdentities.length,
          missingIdentities: uniqueMissingIdentities.slice(0, 12),
          reasonCounts: Object.fromEntries(reasonCounts),
          decision: 'KEEP_PREVIOUS_COMPLETE_SET',
          projectionWrites: 0,
          retryState: 'PARKED',
        })
      }

      this.emitCaptionReconcilePerf(snapshot, 'DEFER', plan.length, retryDecision, stateToken, previous ? publishedPlanCount : 0, publishedPlanCount)

      if (retryDecision === 'ALLOW_ONE_FOLLOW_UP') {
        // ONE coalesced follow-up through the existing event-driven scheduler.
        this.requestNumberingReconcile({
          reason: `caption-deferred-candidate:${transientUnresolvedCount}`,
          invalidation: ['HEADING_SEMANTICS_CHANGED', 'OBJECT_STRUCTURE_CHANGED'],
        })
      }
      return
    }

    // COMPLETE → IDLE (release any deferred retry state).
    this.captionDeferredRetry.markComplete()
    this.captionReconcileInitialCount++

    const objectEntries: CaptionObjectEntry[] = plan.map((item, i) => {
      const res = captionResolutions[i]
      const resolved = res.decision !== 'TRANSIENT_UNRESOLVED'
      return {
        stableIdentity: item.recordId ?? this.runtimeKeyForTarget(item.target, targets),
        objectKind: item.type,
        precedingHeadingStableIdentity: resolved ? res.headingStableIdentity : null,
        name: item.name,
        structureMode: snapshot?.structureMode ?? 'loose',
        strictBoundaryIdentity: resolved ? res.strictBoundaryIdentity : null,
        structuralChapterIdentity: resolved ? res.structuralChapterIdentity : null,
        structuralSectionIdentity: resolved ? res.structuralSectionIdentity : null,
        chapterOrdinal: resolved ? res.chapterOrdinal : null,
        sectionOrdinal: resolved ? res.sectionOrdinal : null,
      }
    })

    const desiredStates = snapshot
      ? computeProductionDesiredCaptionStates(snapshot, objectEntries, productionConfigs)
      : []

    // ATOMIC PUBLISH (only reached with a COMPLETE candidate).
    const previousCompleteCaptionCount = this.lastCompleteCaptionPlanSet?.states.length ?? 0
    this.lastCompleteCaptionPlanSet = {
      documentKey: snapshot?.documentKey ?? this.currentDocumentKey ?? '',
      snapshotRevision: snapshot?.revision ?? -1,
      editorStructureEpoch: this.editorStructureEpochValue,
      headingBindingGeneration: this.ctx.getHeadingBindingGeneration?.() ?? this.lastHeadingBindingGeneration,
      expectedTargetCount: plan.length,
      resolvedTargetCount: resolvedCount,
      states: desiredStates,
    }
    incHeadingSemanticPerf('captionSemanticReconcileCount')
    this.emitCaptionReconcilePerf(snapshot, 'COMPLETE', plan.length, 'COMPLETE_TO_IDLE', this.computeCaptionStateToken(snapshot, plan), previousCompleteCaptionCount, desiredStates.length)
    emitRuntimeAudit('CAPTION-PLAN-SET-PUBLISH', {
      documentKey: snapshot?.documentKey ?? this.currentDocumentKey ?? null,
      snapshotRevision: snapshot?.revision ?? -1,
      editorStructureEpoch: this.editorStructureEpochValue,
      headingBindingGeneration: this.ctx.getHeadingBindingGeneration?.() ?? this.lastHeadingBindingGeneration,
      previousCompletePlanCount: previousCompleteCaptionCount,
      candidatePlanCount: desiredStates.length,
      publishedPlanCount: desiredStates.length,
      canonicalTargetCount: plan.length,
      decision: 'ATOMIC_PUBLISH',
      transientUnresolvedCount: 0,
    })

    const numbered = plan.map((item, i) => {
      const desired = desiredStates[i]
      return {
        ...item,
        number: desired?.ordinal ?? 0,
        renderedNumber: desired?.rawNumber ?? '',
      }
    })
    if (forensicVerboseEnabled()) {
      for (let i = 0; i < numbered.length; i++) {
        const item = numbered[i]
        const cfg = resolveCaptionTypeSettings(this.captionSettings, item.type)
        console.info(
          `[InkChapter Numbering] NUMBERING-RESULT type=${item.type} mode=${cfg.numberingMode ?? 'continuous'} ` +
          `startAt=${cfg.startAt ?? 1} numberStyle=${cfg.numberStyle ?? 'arabic'} template=${cfg.template ?? '{n}'} ` +
          `sequenceValue=${item.number} renderedNumber=${item.renderedNumber} labelJson=${JSON.stringify(buildObjectNumberingLabel(cfg.prefix, item.renderedNumber, item.name ?? ''))}`,
        )
      }
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
      this.perfTracker.mark('T4')
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

    this.refreshFormulaNumbering(invalidationMask)

    // Phase 7R.3.4-A: documents with no block Formulas become stable right after
    // the non-formula projection commits (no MathJax dependency to wait for).
    if (this.lastFormulaTargets.length === 0) {
      this.perfTracker.finalize(docKey)
    }

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
   * Formula numbering runtime pass (Phase 7). Formula now consumes the SAME
   * canonical authority as Figure/Table/Code:
   *
   *   formula canonical target → shared resolvePrecedingSemanticHeading()
   *   → HeadingNumberingSnapshot.semantic → shared scope resolver
   *   → independent Formula ordinal → shared standard preset formatter
   *   → rawNumber → "(rawNumber)" wrapper → existing MathJax projection.
   *
   * No DOM heading numbers are parsed. In NO_SNAPSHOT / DOCUMENT_CONTEXT_MISMATCH
   * states the semantic projection DEFERS with zero writes.
   */
  private refreshFormulaNumbering(invalidationMask = 0): void {
    const root = this.currentEditorRoot
    if (!root) { this.formulaAdapter.clearAll(); this.projectionController.clearAll(); return }

    const config = this.formulaConfig
    const mode = config.formulaMode ?? 'typora-native'
    const enabled = config.enabled
    const semanticMode = mode === 'inkchapter' && enabled

    const snapshot = this.ctx.getHeadingNumberingSnapshot?.() ?? null
    const activeDocKey = this.ctx.getDocumentKey?.() ?? null
    // Phase 7R.3.2: LIVE hook context is updated here and read fresh per MathJax
    // call — never frozen into the install-time wrapper closure.
    this.hookLiveContext = {
      documentKey: activeDocKey,
      controller: this.projectionController,
      headingSnapshotRevision: snapshot?.revision ?? null,
    }
    // Phase 7R.3: document switch must never leak a previous document's plan.
    if (activeDocKey !== this.lastFormulaProjectionDocKey) {
      this.projectionController.clearAll()
      this.lastFormulaProjectionDocKey = activeDocKey
    }
    // Narrowed to a concrete snapshot once the semantic-mode guards pass.
    let semanticSnapshot: HeadingNumberingSnapshot | null = null

    if (semanticMode) {
      if (!snapshot) {
        this.projectionController.clearAll()
        emitRuntimeAudit('FORMULA-SEMANTIC-PROJECTION-DEFER', { reason: 'NO_SNAPSHOT', projectionWrites: 0 })
        return
      }
      if (!activeDocKey || activeDocKey !== snapshot.documentKey) {
        this.projectionController.clearAll()
        emitRuntimeAudit('FORMULA-SEMANTIC-PROJECTION-DEFER', { reason: 'DOCUMENT_CONTEXT_MISMATCH', projectionWrites: 0 })
        return
      }
      semanticSnapshot = snapshot
    } else {
      // typora-native / disabled: InkChapter never owns projection.
      this.projectionController.clearAll()
    }

    const formulaTargets = this.formulaAdapter.collectFormulaTargets()
    this.lastFormulaTargets = formulaTargets
    const items: FormulaReconcileItem[] = []

    if (semanticMode) {
      // Phase 7R.1-A: bounded Formula host ownership forensic + cardinality gate.
      // Raw candidates scan the BROAD selector; only LOGICAL_SOURCE_HOST nodes
      // become business targets. Rendered MathJax output never consumes an ordinal.
      const snap = semanticSnapshot as HeadingNumberingSnapshot
      const rawCandidates = root.querySelectorAll(MATH_HOST_SELECTOR).length
      const uniqueHosts = new Set(formulaTargets.map(t => t.root)).size
      const renderedMathJaxBusinessTargetCount = formulaTargets.filter(
        t => t.root.matches('mjx-container') || t.root.classList.contains('MathJax'),
      ).length
      const ownership = this.formulaAdapter.formulaHostOwnershipForensic()
      const logicalHostCount = ownership.filter(e => e.decision === 'ACCEPT_BUSINESS_TARGET').length
      const renderedMathJaxHostCount = ownership.filter(e => e.candidateRole === 'RENDERED_MATHJAX_HOST').length
      // Phase 7R.3.8-C: document-aware cardinality diagnostic. All counts come
      // from the CURRENT document — the fixture-specific `expected=4` contract
      // NEVER leaks into the generic production marker. The logical inventory
      // (ownership forensic ACCEPT_BUSINESS_TARGET) is an independent collection
      // from the canonical target array, so the comparison is not tautological.
      const duplicateCanonicalHostCount = Math.max(0, formulaTargets.length - uniqueHosts)
      const cardinalityDecision: 'CONSISTENT' | 'CARDINALITY_MISMATCH' | 'DUPLICATE_CANONICAL_HOST' | 'RENDERED_NODE_LEAK' =
        renderedMathJaxBusinessTargetCount > 0
          ? 'RENDERED_NODE_LEAK'
          : duplicateCanonicalHostCount > 0
            ? 'DUPLICATE_CANONICAL_HOST'
            : logicalHostCount === formulaTargets.length
              ? 'CONSISTENT'
              : 'CARDINALITY_MISMATCH'
      emitRuntimeAudit('FORMULA-TARGET-CARDINALITY', {
        documentKey: snap.documentKey,
        logicalFormulaHostCount: logicalHostCount,
        canonicalFormulaTargetCount: formulaTargets.length,
        uniqueCanonicalHostCount: uniqueHosts,
        renderedMathJaxBusinessTargetCount: renderedMathJaxBusinessTargetCount,
        duplicateCanonicalHostCount,
        expectedLogicalFormulaCount: 'NOT_APPLICABLE',
        expectationSource: 'NONE',
        decision: cardinalityDecision,
        renderedMathJaxHostCount,
        rawCandidates,
      })
      for (const entry of ownership.slice(0, 24)) {
        if (!forensicVerboseEnabled()) break
        emitRuntimeAudit('FORMULA-HOST-OWNERSHIP-FORENSIC', {
          documentKey: snap.documentKey,
          candidateTag: entry.candidateTag,
          candidateClass: entry.candidateClass,
          candidateConnected: entry.candidateConnected,
          candidateRole: entry.candidateRole,
          candidateParentTag: entry.candidateParentTag,
          candidateParentClass: entry.candidateParentClass,
          insideLogicalFormulaHost: entry.insideLogicalFormulaHost,
          containsMjxContainer: entry.containsMjxContainer,
          sameLogicalFormulaOwnershipToken: entry.sameLogicalFormulaOwnershipToken,
          decision: entry.decision,
        })
      }
    }

    if (!semanticMode) {
      // Native / disabled: restore Typora native tags, no InkChapter semantic write.
      for (const t of formulaTargets) {
        items.push({ target: t, renderedNumber: '', label: '', mode, enabled })
      }
    } else {
      const snap = semanticSnapshot as HeadingNumberingSnapshot
      const cfg = migrateObjectNumberingConfig('formula', config)

      // Phase 7R.3.4-E: bind ALL formula targets in ONE forward sweep (single
      // canonical heading bindings session per reconcile).
      const formulaRoots = formulaTargets.map(t => t.root)
      const batchFormulaResolved = this.ctx.resolvePrecedingSemanticHeadingBatch
        ? this.ctx.resolvePrecedingSemanticHeadingBatch(formulaRoots)
        : null

      // Phase 7R.3.6-G: EXPLICIT per-target semantic resolution — never a silent
      // chapter=null/section=null → GLOBAL fallback for transient resolver
      // incoherence. TRANSIENT_UNRESOLVED defers the whole plan-set candidate.
      const resolutions: FormulaSemanticResolution[] = formulaTargets.map((t, fi) => {
        const runtimeKey = `formula:${t.ordinal}`
        if (forensicVerboseEnabled()) {
          emitRuntimeAudit('FORMULA-CANONICAL-TARGET', {
            documentKey: snap.documentKey,
            formulaRuntimeKey: runtimeKey,
            targetTag: t.root.tagName,
            targetClass: (t.root.className || '').slice(0, 40),
            targetConnected: t.root.isConnected,
            sameEditorRoot: root.contains(t.root),
            targetDecision: 'ACCEPT_BLOCK_FORMULA',
          })
        }
        const resolved = batchFormulaResolved !== null
          ? batchFormulaResolved[fi]
          : (this.ctx.resolvePrecedingSemanticHeading?.(t.root)
              ? (() => {
                  const single = this.ctx.resolvePrecedingSemanticHeading!(t.root)!
                  return { bound: true as const, documentKey: single.documentKey, revision: single.revision, headingStableIdentity: single.headingStableIdentity, semanticState: single.semanticState }
                })()
              : { bound: false as const, reason: 'NO_PRECEDING_HEADING' })
        let res: FormulaSemanticResolution
        if (!resolved) {
          res = { decision: 'TRANSIENT_UNRESOLVED', reason: 'OTHER_TRANSIENT_INCOHERENCE' }
        } else if (resolved.bound) {
          res = classifyFormulaSemanticResolution(true, null, resolved.headingStableIdentity, resolved.semanticState)
        } else {
          res = classifyFormulaSemanticResolution(false, resolved.reason, null, null)
        }
        if (forensicVerboseEnabled()) {
          emitRuntimeAudit('FORMULA-SEMANTIC-RESOLUTION', {
            documentKey: snap.documentKey,
            revision: snap.revision,
            formulaRuntimeKey: runtimeKey,
            decision: res.decision,
            transientReason: res.decision === 'TRANSIENT_UNRESOLVED' ? res.reason : null,
            headingStableIdentity: res.decision === 'TRANSIENT_UNRESOLVED' ? null : res.headingStableIdentity,
            chapterOrdinal: res.decision === 'TRANSIENT_UNRESOLVED' ? null : res.chapterOrdinal,
            sectionOrdinal: res.decision === 'TRANSIENT_UNRESOLVED' ? null : res.sectionOrdinal,
            strictBoundaryIdentity: res.decision === 'TRANSIENT_UNRESOLVED' ? null : res.strictBoundaryIdentity,
            structuralChapterIdentity: res.decision === 'TRANSIENT_UNRESOLVED' ? null : res.structuralChapterIdentity,
            structuralSectionIdentity: res.decision === 'TRANSIENT_UNRESOLVED' ? null : res.structuralSectionIdentity,
            targetConnected: t.root.isConnected,
          })
        }
        return res
      })

      // Build the COMPLETE plan-set candidate off to the side and atomically
      // publish ONLY when complete. Deferred candidates keep the previous
      // COMPLETE plan set (projectionWrites=0) and retry via the coalesced
      // scheduler (no timers).
      const explicitFormulaStructureChange = (invalidationMask & RECONCILE_INVALIDATION.FORMULA_STRUCTURE_CHANGED) !== 0
      const completePlanSet = this.buildAndPublishFormulaPlanSet(snap, formulaTargets, resolutions, cfg, mode, activeDocKey, explicitFormulaStructureChange)
      const desiredNumberFor = (t: FormulaTarget): string =>
        completePlanSet?.plans.get(t.root)?.renderedNumber ?? ''

      this.perfTracker.mark('T5')
      this.perfTracker.incFormulaPlanBuild()
      incHeadingSemanticPerf('formulaSemanticPlanBuildCount')
      formulaTargets.forEach((t) => {
        const renderedNumber = desiredNumberFor(t)
        emitRuntimeAudit('FORMULA-PROJECTION-RECONCILE', { decision: 'PLAN' })
        items.push({ target: t, renderedNumber, label: renderedNumber, mode, enabled: true })
      })
    }

    this.rendering = true
    try {
      this.formulaAdapter.reconcile(items)
    } finally {
      this.rendering = false
    }

    // Phase 7R.2-A2: BEST-EFFORT visible-projection forensic — strictly AFTER
    // business reconcile and fully isolated (try/catch) so it can NEVER block
    // or abort Formula projection. READ-ONLY observation only.
    if (semanticMode) {
      this.emitVisibleProjectionForensic(semanticSnapshot as HeadingNumberingSnapshot, formulaTargets, items, mode)
    }
  }

  /**
   * Phase 7R.3.6-H/I: build a COMPLETE Formula plan-set candidate OFF to the
   * side and atomically publish it ONLY when complete.
   *
   *   - Provenance (documentKey / editorStructureEpoch / snapshotRevision /
   *     headingBindingGeneration / canonicalHostFingerprint) is captured at
   *     candidate start and re-validated before publication.
   *   - Any TRANSIENT_UNRESOLVED Formula → DEFER_TRANSIENT_UNRESOLVED; the
   *     previous COMPLETE plan set survives untouched (projectionWrites=0).
   *   - A COMPLETE candidate increments the plan-set epoch and diff-creates
   *     activations for changed signatures (ONE-SHOT per activation budget).
   */
  private buildAndPublishFormulaPlanSet(
    snap: HeadingNumberingSnapshot,
    formulaTargets: FormulaTarget[],
    resolutions: FormulaSemanticResolution[],
    cfg: ObjectNumberingConfig,
    mode: string,
    activeDocKey: string | null,
    explicitFormulaStructureChange: boolean,
  ): FormulaCompletePlanSet | null {
    try {
      const markdown = this.ctx.getMarkdown?.() ?? ''
      const sources = scanDisplayMathSources(markdown)
      const policy = normalizeTyporaAutoNumberingPolicy(readTyporaAutoNumberingForMath())
      this.projectionController.setExpectedPlanCount(formulaTargets.length)

      // ── Provenance captured at candidate start (Phase 7R.3.6-F §18-19) ──
      const headingBindingGeneration = this.ctx.getHeadingBindingGeneration?.() ?? this.lastHeadingBindingGeneration
      this.lastHeadingBindingGeneration = headingBindingGeneration
      const candidateStartEpoch = this.editorStructureEpochValue
      const canonicalHostFingerprint = fingerprintFormulaHosts(formulaTargets)
      this.lastCanonicalFormulaHostFingerprint = canonicalHostFingerprint

      const transientUnresolvedCount = resolutions.filter(r => r.decision === 'TRANSIENT_UNRESOLVED').length
      const resolvedCount = resolutions.filter(isResolvedFormulaSemantic).length

      // ── Coherence decision (Phase 7R.3.6-I §24, pure helper) ─────────
      const decision = decideFormulaCandidateCoherence({
        activeDocumentKey: activeDocKey,
        snapDocumentKey: snap.documentKey,
        candidateStartEpoch,
        liveEpoch: this.editorStructureEpochValue,
        bindingGenerationAtStart: headingBindingGeneration,
        bindingGenerationLive: this.ctx.getHeadingBindingGeneration?.() ?? headingBindingGeneration,
        transientUnresolvedCount,
        previousCompletePlanSetDocumentKey: this.lastCompletePlanSet?.documentKey ?? null,
        previousCanonicalHostFingerprint: this.lastCompletePlanSet?.canonicalHostFingerprint ?? '',
        canonicalHostFingerprint,
        explicitFormulaStructureChange,
      })

      // ── Build plan entries ONLY from resolved contexts, in target order ──
      const planEntries: Array<{ target: FormulaTarget; plan: FormulaNativeRenderPlan }> = []
      if (decision === 'COMPLETE') {
        // Phase 7R.3.7: each context carries boundary + structural provenance
        // so Formula scopeKey and projection signature are boundary-aware.
        const formulaContexts = formulaTargets.map((_t, i) => {
          const ctx = resolutionToFormulaContext(resolutions[i])
          if (!ctx) return { chapterOrdinal: null, sectionOrdinal: null, mode: snap.structureMode }
          return { ...ctx, mode: snap.structureMode }
        })
        const planned = planFormulaSemanticNumbers(formulaContexts, cfg)
        for (let i = 0; i < formulaTargets.length; i++) {
          const t = formulaTargets[i]
          const sourceTex = sources[i] ?? ''
          if (sourceTex.length === 0) continue
          const context: FormulaProjectionContext = {
            formulaMode: mode === 'inkchapter' ? 'inkchapter' : 'typora-native',
            typoraAutoNumberingPolicy: policy,
            snapshotReady: true,
            documentCoherent: activeDocKey === snap.documentKey,
            rendererReady: !!t.root.querySelector('mjx-container, .MathJax'),
          }
          const authority = this.projectionController.arbitrate(context)
          if (authority !== 'inkchapter-native-transient') continue
          const p = planned[i]
          if (!p) continue
          planEntries.push({
            target: t,
            plan: {
              documentKey: snap.documentKey,
              revision: snap.revision,
              sourceHash: hashFormulaSource(sourceTex),
              rawNumber: p.rawNumber,
              renderedNumber: p.renderedNumber,
              formulaRuntimeKey: `formula:${t.ordinal}`,
              authority: 'inkchapter-native-transient',
              formulaMode: 'inkchapter',
              strictBoundaryIdentity: p.strictBoundaryIdentity,
              structuralChapterIdentity: p.structuralChapterIdentity,
              structuralSectionIdentity: p.structuralSectionIdentity,
              effectiveScope: p.effectiveScope,
            },
          })
        }
      }

      const candidate: FormulaPlanSetCandidate = {
        documentKey: snap.documentKey,
        editorStructureEpoch: candidateStartEpoch,
        snapshotRevision: snap.revision,
        headingBindingGeneration,
        canonicalHostFingerprint,
        expectedFormulaHostCount: formulaTargets.length,
        resolvedFormulaCount: resolvedCount,
        transientUnresolvedCount,
        resolutions,
        planEntries,
      }
      this.emitCandidateCoherence(candidate, decision)

      if (decision !== 'COMPLETE') {
        this.deferIncompleteCandidate(candidate, decision)
        // Keep the previous COMPLETE plan set as the desired-number authority.
        return this.lastCompletePlanSet
      }

      // ── ATOMIC PUBLISH (Phase 7R.3.6-I §27) ───────────────────────────
      const previousComplete = this.lastCompletePlanSet
      const previousPlanSetEpoch = this.projectionController.getPlanSetEpoch()
      const newPlanSetEpoch = this.projectionController.beginPlanSetEpoch()
      const newPlans = new Map<HTMLElement, FormulaNativeRenderPlan>()
      const affectedHosts: FormulaTarget[] = []
      const affectedKeys: string[] = []
      const reasonSummary = new Map<string, number>()

      for (const entry of candidate.planEntries) {
        const diff = this.projectionController.applyProjectionPlan(entry.target.root, entry.plan, {
          reason: classifyPlanChange(previousComplete?.plans.get(entry.target.root) ?? undefined, entry.plan),
          planSetEpoch: newPlanSetEpoch,
          headingSnapshotRevision: snap.revision,
          editorStructureEpoch: this.editorStructureEpochValue,
        })
        newPlans.set(entry.target.root, entry.plan)
        // Phase 7R.3.6-E: non-initial transitions must never lose previous lineage.
        if (diff.transition && diff.transition.previousActivationId !== null && diff.transition.previousSignatureHash === null) {
          this.previousSignatureNullOnNonInitialTransitionCount++
          emitRuntimeAudit('FORMULA-TRANSITION-LINEAGE', {
            documentKey: snap.documentKey,
            formulaRuntimeKey: entry.plan.formulaRuntimeKey,
            currentActivationId: diff.transition.currentActivationId,
            previousActivationId: diff.transition.previousActivationId,
            previousSignatureHash: diff.transition.previousSignatureHash,
            decision: 'PREVIOUS_SIGNATURE_NULL_ON_NONINITIAL_TRANSITION',
          })
        }
        if (diff.affected) {
          affectedHosts.push(entry.target)
          affectedKeys.push(entry.plan.formulaRuntimeKey)
          reasonSummary.set(diff.reason, (reasonSummary.get(diff.reason) ?? 0) + 1)
        }
        emitRuntimeAudit('FORMULA-TRANSIENT-PLAN-PUBLISH', {
          documentKey: snap.documentKey,
          formulaRuntimeKey: entry.plan.formulaRuntimeKey,
          sourceHash: entry.plan.sourceHash,
          rawNumber: entry.plan.rawNumber,
          planSetEpoch: newPlanSetEpoch,
          activationId: diff.activation?.activationId ?? null,
          planGeneration: this.projectionController.getPlanGeneration(),
          snapshotRevision: snap.revision,
          rendererReadyAtPublish: !!entry.target.root.querySelector('mjx-container, .MathJax'),
          affected: diff.affected,
          reason: diff.reason,
          decision: 'ATOMIC_PUBLISH',
        })
      }

      const newCompleteSet: FormulaCompletePlanSet = {
        planSetEpoch: newPlanSetEpoch,
        documentKey: snap.documentKey,
        editorStructureEpoch: this.editorStructureEpochValue,
        snapshotRevision: snap.revision,
        headingBindingGeneration,
        canonicalHostFingerprint,
        targets: formulaTargets,
        plans: newPlans,
      }
      this.lastCompletePlanSet = newCompleteSet
      this.projectionController.bumpPlanGeneration()

      emitRuntimeAudit('FORMULA-PLAN-SET-PUBLISH', {
        documentKey: snap.documentKey,
        previousPlanSetEpoch,
        currentPlanSetEpoch: newPlanSetEpoch,
        previousCompletePlanCount: previousComplete ? previousComplete.plans.size : 0,
        candidatePlanCount: candidate.planEntries.length,
        publishedPlanCount: newPlans.size,
        canonicalFormulaHostCount: formulaTargets.length,
        decision: 'ATOMIC_PUBLISH',
      })
      emitRuntimeAudit('FORMULA-PROJECTION-AFFECTED-SET', {
        documentKey: snap.documentKey,
        previousPlanCount: previousComplete ? previousComplete.plans.size : 0,
        nextPlanCount: newPlans.size,
        affectedCount: affectedKeys.length,
        unchangedCount: newPlans.size - affectedKeys.length,
        affectedFormulaRuntimeKeys: affectedKeys,
        reasonSummary: Object.fromEntries(reasonSummary),
        planSetEpoch: newPlanSetEpoch,
        decision: affectedKeys.length > 0 ? 'AFFECTED' : 'NO_OP',
      })

      // The hook is a SINGLE STABLE WRAPPER installed once; it reads the LIVE
      // context on every MathJax call. Phase 7R.3.4-F: never re-enter the
      // install path once INSTALLED.
      if (getMathJaxHookLifecycle() !== 'INSTALLED') {
        ensureMathJaxRenderInputHook({ getLiveContext: this.hookLiveContextProvider })
      }
      emitRuntimeAudit('FORMULA-PROJECTION-LIVE-CONTEXT', {
        liveDocumentKey: this.hookLiveContext.documentKey,
        liveSnapshotRevision: this.hookLiveContext.headingSnapshotRevision,
        activePlanCount: this.projectionController.inventory().planCount,
        planGeneration: this.projectionController.getPlanGeneration(),
        planSetEpoch: newPlanSetEpoch,
        decision: this.projectionController.inventory().planCount > 0 ? 'READY' : 'NOT_READY',
      })

      // Phase 7R.3.3-D / 7R.3.6-D: rerender ONLY affected hosts, one-shot per
      // ACTIVATION.
      this.requestControlledRecoveryRenders(affectedHosts, mode, activeDocKey, snap.documentKey)
      return newCompleteSet
    } catch (error) {
      // Arbitration failure must never abort formula reconcile.
      emitRuntimeAudit('FORMULA-PROJECTION-ARBITRATION-ERROR', {
        documentKey: snap.documentKey,
        errorName: error instanceof Error ? error.name : 'UNKNOWN_ERROR',
        errorMessage: error instanceof Error ? error.message.slice(0, 200) : String(error).slice(0, 200),
        decision: 'ARBITRATION_ERROR_IGNORED',
        businessProjectionBlocked: false,
      })
      return this.lastCompletePlanSet
    }
  }

  /** FORMULA-PLAN-CANDIDATE-COHERENCE audit (low-noise: bounded summary). */
  private emitCandidateCoherence(candidate: FormulaPlanSetCandidate, decision: FormulaCandidateCoherenceDecision): void {
    emitRuntimeAudit('FORMULA-PLAN-CANDIDATE-COHERENCE', {
      documentKey: candidate.documentKey,
      editorStructureEpochStart: candidate.editorStructureEpoch,
      editorStructureEpochEnd: this.editorStructureEpochValue,
      snapshotRevision: candidate.snapshotRevision,
      headingBindingGeneration: candidate.headingBindingGeneration,
      canonicalFormulaHostCount: candidate.expectedFormulaHostCount,
      candidatePlanCount: candidate.planEntries.length,
      resolvedCount: candidate.resolvedFormulaCount,
      legitimateChapterFallbackCount: candidate.resolutions.filter(r => r.decision === 'LEGITIMATE_CHAPTER_FALLBACK').length,
      legitimateGlobalFallbackCount: candidate.resolutions.filter(r => r.decision === 'LEGITIMATE_GLOBAL_FALLBACK').length,
      transientUnresolvedCount: candidate.transientUnresolvedCount,
      canonicalHostFingerprintBefore: this.lastCanonicalFormulaHostFingerprint,
      canonicalHostFingerprintAfter: candidate.canonicalHostFingerprint,
      decision,
    })
  }

  /** CAPTION-PLAN-CANDIDATE-COHERENCE audit (Phase 7R.3.7 §11). */
  private emitCaptionCandidateCoherence(
    snapshot: HeadingNumberingSnapshot | null,
    canonicalTargetCount: number,
    resolvedCount: number,
    legitimateChapterFallbackCount: number,
    legitimateGlobalFallbackCount: number,
    transientUnresolvedCount: number,
    decision: CaptionCandidateCoherenceDecision,
  ): void {
    emitRuntimeAudit('CAPTION-PLAN-CANDIDATE-COHERENCE', {
      documentKey: snapshot?.documentKey ?? this.currentDocumentKey ?? null,
      snapshotRevision: snapshot?.revision ?? -1,
      editorStructureEpoch: this.editorStructureEpochValue,
      headingBindingGeneration: this.ctx.getHeadingBindingGeneration?.() ?? this.lastHeadingBindingGeneration,
      canonicalTargetCount,
      candidatePlanCount: canonicalTargetCount,
      resolvedCount,
      legitimateChapterFallbackCount,
      legitimateGlobalFallbackCount,
      transientUnresolvedCount,
      decision,
    })
  }

  /**
   * Phase 7R.3.9: deterministic Caption reconcile state token. Built ONLY from
   * authorities that can genuinely change the Caption result. No timestamps,
   * no retry counters, no no-op generations.
   */
  private computeCaptionStateToken(
    snapshot: HeadingNumberingSnapshot | null,
    plan: Array<{ type: CaptionTargetType }>,
  ): string {
    const frameFingerprint = this.ctx.getCanonicalHeadingFrameFingerprint?.() ?? ''
    return buildCaptionReconcileStateToken({
      documentKey: snapshot?.documentKey ?? this.currentDocumentKey ?? null,
      editorStructureEpoch: this.editorStructureEpochValue,
      headingSemanticFingerprint: computeHeadingSemanticFingerprint(snapshot),
      canonicalHeadingFrameFingerprint: frameFingerprint,
      canonicalTargetFingerprint: buildCaptionTargetFingerprint(plan.map(p => p.type)),
      settingsSemanticSignature: this.computeCaptionSettingsSignature(),
    })
  }

  /** Deterministic semantic signature of the current caption configuration. */
  private computeCaptionSettingsSignature(): string {
    const parts: string[] = []
    for (const type of ['figure', 'table', 'code'] as const) {
      const cfg = resolveCaptionTypeSettings(this.captionSettings, type)
      parts.push(`${type}:${cfg.enabled ? 1 : 0}:${cfg.numberingMode ?? 'continuous'}:${cfg.prefix ?? ''}:${cfg.startAt ?? 1}:${cfg.template ?? '{n}'}`)
    }
    return fastHash(parts.join('|'))
  }

  /**
   * Phase 7R.3.9: ONE CAPTION-UNRESOLVED-SUMMARY per distinct failure signature
   * (state dedup — never a per-target log storm). Detailed missing-identity
   * forensic is capped at one per unique identity.
   */
  private emitCaptionUnresolvedSummary(
    snapshot: HeadingNumberingSnapshot | null,
    stateToken: string,
    unresolvedTargetCount: number,
    reasonCounts: Map<string, number>,
    uniqueMissingIdentities: string[],
    failureSignature: string,
    rawMissingIdentities: string[],
  ): void {
    if (failureSignature === this.lastReportedCaptionFailureSignature) return
    this.lastReportedCaptionFailureSignature = failureSignature

    const identityAffected = new Map<string, number>()
    for (const id of rawMissingIdentities) identityAffected.set(id, (identityAffected.get(id) ?? 0) + 1)

    emitRuntimeAudit('CAPTION-UNRESOLVED-SUMMARY', {
      documentKey: snapshot?.documentKey ?? this.currentDocumentKey ?? null,
      stateToken,
      unresolvedTargetCount,
      uniqueMissingHeadingIdentityCount: uniqueMissingIdentities.length,
      reasonCounts: Object.fromEntries(reasonCounts),
      missingHeadingIdentities: Object.fromEntries(identityAffected),
    })

    // One targeted detailed record per UNIQUE missing identity (capped).
    for (const id of uniqueMissingIdentities.slice(0, 8)) {
      emitRuntimeAudit('HEADING-CANONICAL-BINDING-DRIFT', {
        documentKey: snapshot?.documentKey ?? this.currentDocumentKey ?? null,
        stableIdentity: id,
        semanticLookupFound: false,
        bindingLookupFound: true,
        sourceCollector: 'CAPTION_UNRESOLVED',
        affectedTargetCount: identityAffected.get(id) ?? 0,
      })
    }
  }

  /** Phase 7R.3.9: one bounded CAPTION-RECONCILE-PERF record per full reconcile. */
  private emitCaptionReconcilePerf(
    snapshot: HeadingNumberingSnapshot | null,
    phase: 'COMPLETE' | 'DEFER',
    targetCount: number,
    retryDecision: string,
    stateToken: string,
    previousCompletePlanCount: number,
    publishedPlanCount: number,
  ): void {
    const gates = this.captionDeferredRetry.getGateCounters()
    emitRuntimeAudit('CAPTION-RECONCILE-PERF', {
      documentKey: snapshot?.documentKey ?? this.currentDocumentKey ?? null,
      reason: this.lastRefreshReason ?? 'reconcile',
      stateToken,
      retryState: retryDecision === 'ALLOW_ONE_FOLLOW_UP' ? 'FOLLOW_UP_ALLOWED' : (retryDecision === 'COMPLETE_TO_IDLE' ? 'IDLE' : 'PARKED'),
      targetCount,
      previousCompletePlanCount,
      publishedPlanCount,
      decision: phase === 'COMPLETE' ? 'COMPLETE' : 'DEFER_FOLLOW_UP',
      gate: {
        CAPTION_DEFER_TIMER_POLLING_COUNT: this.captionDeferredTimerPollingCount,
        CAPTION_PARKED_STATE_SELF_WAKE_COUNT: this.captionParkedStateSelfWakeCount,
        CAPTION_HOT_LOOP_GUARD_TRIGGERED_COUNT: this.captionHotLoopGuardTriggeredCount,
        CAPTION_CANONICAL_INVARIANT_FAILURE_COUNT: this.captionCanonicalInvariantFailureCount,
        CAPTION_FOLLOW_UP_COUNT: gates.followUpCount,
        CAPTION_PARKED_COUNT: gates.parkedCount,
        MAX_FOLLOW_UP_PER_UNCHANGED_STATE_TOKEN: gates.maxFollowUpPerUnchangedStateToken,
        CAPTION_RECONCILE_INITIAL_COUNT: this.captionReconcileInitialCount,
        CAPTION_RECONCILE_FOLLOW_UP_COUNT: this.captionReconcileFollowUpCount,
      },
    })
  }

  /**
   * Phase 7R.3.6-J: a deferred candidate must NOT publish (projectionWrites=0)
   * and retries via the existing coalesced scheduler — at most ONE follow-up per
   * reconcile, only when NEW structure/semantic information actually arrived.
   */
  private deferIncompleteCandidate(candidate: FormulaPlanSetCandidate, decision: FormulaCandidateCoherenceDecision): void {
    this.transientCandidateDeferCount++
    const previous = this.lastCompletePlanSet
    const publishedPlanCount = previous ? previous.plans.size : 0
    const publish = computePlanSetPublish({
      decision,
      previousCompletePlanCount: publishedPlanCount,
      candidatePlanCount: candidate.planEntries.length,
    })
    emitRuntimeAudit('FORMULA-PLAN-SET-PUBLISH', {
      documentKey: candidate.documentKey,
      previousPlanSetEpoch: previous ? previous.planSetEpoch : this.projectionController.getPlanSetEpoch(),
      currentPlanSetEpoch: previous ? previous.planSetEpoch : this.projectionController.getPlanSetEpoch(),
      previousCompletePlanCount: publishedPlanCount,
      candidatePlanCount: candidate.planEntries.length,
      publishedPlanCount: publish.publishedPlanCount,
      canonicalFormulaHostCount: candidate.expectedFormulaHostCount,
      decision: publish.publishDecision,
      candidateCoherenceDecision: decision,
      projectionWrites: 0,
      activationCreatedCount: 0,
      controlledRerenderRequestedCount: 0,
      noOp: publish.noOp,
    })
    // Bound the retry: only request a follow-up when the snapshot revision or
    // structure epoch actually advanced since this candidate was built (avoids
    // an infinite microtask loop on a permanently-incoherent state).
    const snapshot = this.ctx.getHeadingNumberingSnapshot?.() ?? null
    const newInfoArrived =
      snapshot !== null
      && (snapshot.revision !== candidate.snapshotRevision || this.editorStructureEpochValue !== candidate.editorStructureEpoch)
    if (newInfoArrived) {
      this.requestNumberingReconcile({
        reason: `deferred-candidate:${decision}`,
        invalidation: ['HEADING_SEMANTICS_CHANGED', 'OBJECT_STRUCTURE_CHANGED'],
      })
    }
  }

  /**
   * Phase 7R.3.2-E / 7R.3.3-D / 7R.3.6-D: controlled per-Formula render for
   * AFFECTED hosts. The budget is ONE-SHOT PER ACTIVATION (a NEW activation
   * always starts at 0 — a historical signature never blocks a new activation).
   * Route = the proven per-block Typora seam `File.editor.mathBlock.renderUnder(
   * host, true)`.
   */
  private requestControlledRecoveryRenders(
    affectedHosts: FormulaTarget[],
    mode: string,
    activeDocKey: string | null,
    documentKey: string,
  ): void {
    if (mode !== 'inkchapter') return
    for (const t of affectedHosts) {
      const plan = this.projectionController.getPlan(t.root)
      if (!plan || plan.documentKey !== documentKey || plan.documentKey !== activeDocKey) continue
      if (!t.root.isConnected) continue
      const sigHash = this.projectionController.currentSignatureHash(t.root)
      const activationId = this.projectionController.getActivationId(t.root)
      const rendererReady = !!t.root.querySelector('mjx-container, .MathJax')
      if (!rendererReady) {
        // Phase 7R.3.3 §17: no renderer yet → leave plan-ready for the next
        // natural MathJax render call; never force a global DOM renderer.
        emitRuntimeAudit('FORMULA-CONTROLLED-RERENDER', {
          documentKey,
          formulaRuntimeKey: plan.formulaRuntimeKey,
          projectionSignatureHash: sigHash,
          activationId,
          previousProjectionSignatureHash: this.projectionController.lastRenderRequestedSignatureHash(t.root),
          rawNumber: plan.rawNumber,
          attemptForActivation: this.projectionController.recoveryAttemptCount(t.root),
          route: 'mathBlock.renderUnder',
          decision: 'SKIPPED_NO_RENDERER',
        })
        continue
      }
      if (this.projectionController.wasInjectedForCurrentSignature(t.root)) continue
      const state = this.projectionController.getExecutionState(t.root)
      if (state === 'committed') {
        emitRuntimeAudit('FORMULA-CONTROLLED-RERENDER', {
          documentKey,
          formulaRuntimeKey: plan.formulaRuntimeKey,
          projectionSignatureHash: sigHash,
          activationId,
          previousProjectionSignatureHash: this.projectionController.lastRenderRequestedSignatureHash(t.root),
          rawNumber: plan.rawNumber,
          attemptForActivation: this.projectionController.recoveryAttemptCount(t.root),
          route: 'mathBlock.renderUnder',
          decision: 'SKIPPED_SAME_SIGNATURE_ALREADY_CORRECT',
        })
        continue
      }
      if (state === 'render-requested' || state === 'rendering') {
        const prevReq = this.projectionController.lastRenderRequestedSignatureHash(t.root)
        // Same transaction stuck in flight → a render loop / stuck state.
        if (prevReq === sigHash) this.formulaRenderLoopCount++
        emitRuntimeAudit('FORMULA-CONTROLLED-RERENDER', {
          documentKey,
          formulaRuntimeKey: plan.formulaRuntimeKey,
          projectionSignatureHash: sigHash,
          activationId,
          previousProjectionSignatureHash: prevReq,
          rawNumber: plan.rawNumber,
          attemptForActivation: this.projectionController.recoveryAttemptCount(t.root),
          route: 'mathBlock.renderUnder',
          decision: 'SKIPPED_SAME_SIGNATURE_IN_FLIGHT',
        })
        continue
      }
      if (!this.projectionController.tryReserveRecoveryRender(t.root)) {
        // Phase 7R.3.6-D: the CURRENT activation already consumed its one shot.
        // This must NEVER be caused by a historical signature (new activations
        // always start at 0). Counted as a hard-gate diagnostic.
        this.skippedSameSignatureBudgetExhaustedCount++
        emitRuntimeAudit('FORMULA-CONTROLLED-RERENDER', {
          documentKey,
          formulaRuntimeKey: plan.formulaRuntimeKey,
          projectionSignatureHash: sigHash,
          activationId,
          previousProjectionSignatureHash: this.projectionController.lastRenderRequestedSignatureHash(t.root),
          rawNumber: plan.rawNumber,
          attemptForActivation: this.projectionController.recoveryAttemptCount(t.root),
          historicalSignatureAttemptCount: this.projectionController.getHistoricalSignatureAttemptCount(sigHash),
          route: 'mathBlock.renderUnder',
          decision: 'SKIPPED_SAME_SIGNATURE_BUDGET_EXHAUSTED',
        })
        continue
      }
      const prevRequestedSig = this.projectionController.lastRenderRequestedSignatureHash(t.root)
      this.projectionController.setExecutionState(t.root, 'render-requested')
      this.projectionController.markRenderRequested(t.root)
      this.perfTracker.incControlledRerender()
      emitRuntimeAudit('FORMULA-CONTROLLED-RERENDER', {
        documentKey,
        formulaRuntimeKey: plan.formulaRuntimeKey,
        projectionSignatureHash: sigHash,
        activationId,
        previousProjectionSignatureHash: prevRequestedSig,
        rawNumber: plan.rawNumber,
        attemptForActivation: this.projectionController.recoveryAttemptCount(t.root),
        route: 'mathBlock.renderUnder',
        decision: 'REQUESTED',
      })
      this.invokeTyporaSingleFormulaRender(t.root, plan.formulaRuntimeKey, documentKey)
    }
  }

  /** Narrow, exception-safe invocation of Typora's per-block Formula render seam. */
  private invokeTyporaSingleFormulaRender(host: HTMLElement, formulaRuntimeKey: string, documentKey: string): void {
    try {
      const g = globalThis as {
        File?: { editor?: { mathBlock?: { renderUnder?: (el: Element, force: boolean) => unknown } } }
      }
      const renderUnder = g.File?.editor?.mathBlock?.renderUnder
      if (typeof renderUnder !== 'function') {
        emitRuntimeAudit('FORMULA-CONTROLLED-RERENDER', {
          documentKey,
          formulaRuntimeKey,
          route: 'mathBlock.renderUnder',
          decision: 'FAILED',
          reason: 'ROUTE_NOT_AVAILABLE',
        })
        return
      }
      const result = renderUnder.call(g.File?.editor?.mathBlock, host, true)
      if (result && typeof (result as Promise<unknown>).then === 'function') {
        ;(result as Promise<unknown>).then(
          () => {
            emitRuntimeAudit('FORMULA-CONTROLLED-RERENDER', {
              documentKey,
              formulaRuntimeKey,
              route: 'mathBlock.renderUnder',
              decision: 'COMPLETED',
            })
          },
          () => {
            emitRuntimeAudit('FORMULA-CONTROLLED-RERENDER', {
              documentKey,
              formulaRuntimeKey,
              route: 'mathBlock.renderUnder',
              decision: 'FAILED',
              reason: 'RENDER_REJECTED',
            })
          },
        )
      }
    } catch (error) {
      emitRuntimeAudit('FORMULA-CONTROLLED-RERENDER', {
        documentKey,
        formulaRuntimeKey,
        route: 'mathBlock.renderUnder',
        decision: 'FAILED',
        reason: error instanceof Error ? error.message.slice(0, 120) : String(error).slice(0, 120),
      })
    }
  }

  /** Non-blocking forensic emission; any failure logs and is ignored. */
  private emitVisibleProjectionForensic(
    snap: HeadingNumberingSnapshot,
    formulaTargets: FormulaTarget[],
    items: FormulaReconcileItem[],
    mode: string,
  ): void {
    try {
      const visibleProjection = this.formulaAdapter.formulaVisibleProjectionForensic()
      const autoNumbering = readTyporaAutoNumberingForMath()
      const mathJaxTagMode = this.readMathJaxTagMode()
      const verbose = forensicVerboseEnabled()
      visibleProjection.slice(0, 12).forEach((entry, i) => {
        const t = formulaTargets[i]
        if (!t) return
        if (!verbose) return
        emitRuntimeAudit('FORMULA-VISIBLE-PROJECTION-FORENSIC', {
          documentKey: snap.documentKey,
          formulaRuntimeKey: `formula:${t.ordinal}`,
          desiredRenderedNumber: items[i]?.renderedNumber ?? null,
          logicalHostTag: entry.logicalHostTag,
          logicalHostClass: entry.logicalHostClass,
          typoraAutoNumberingConfigured: autoNumbering ?? null,
          mathJaxTagMode,
          mjxContainerCount: entry.mjxContainerCount,
          svgRootCount: entry.svgRootCount,
          inkchapterDecorationCount: entry.inkchapterDecorationCount,
          nativeDetectorFound: entry.nativeDetectorFound,
          nativeDetectorText: entry.nativeDetectorText,
          mathJaxTagLikeNodeCount: entry.mathJaxTagLikeNodeCount,
          mathJaxTagLikeFingerprints: entry.mathJaxTagLikeFingerprints.slice(0, 6),
          effectiveProjectionChannelsObserved: entry.effectiveProjectionChannelsObserved,
          decision: entry.decision,
        })
      })
      // Phase 7R.3.1-A / 7R.3.3-F / 7R.3.6-L: single-authority verification.
      // semanticCommitted requires an EXACT visible tag-token match against the
      // CURRENT planned rawNumber AND a durable commit for the CURRENT
      // activation. If the visible state is exactly right but the commit
      // metadata was lost, ADOPTED_EXISTING_SEMANTIC_OUTPUT repairs it durably.
      let customDecorationCount = 0
      let duplicateVisibleCount = 0
      let verifiedCount = 0
      let falsePositiveGuardCount = 0
      let firstPendingReason: string | null = null
      visibleProjection.slice(0, 12).forEach((entry, i) => {
        const t = formulaTargets[i]
        if (!t) return
        customDecorationCount += entry.inkchapterDecorationCount
        const plan = this.projectionController.getPlan(t.root)
        const injected = this.projectionController.wasInjectedForCurrentSignature(t.root)
        const committedForCurrentSignature = this.projectionController.isCommittedForCurrentSignature(t.root)
        const lookup = this.projectionController.lastLookup(t.root)
        const desired = items[i]?.renderedNumber ?? null
        // Phase 7R.3.3-F: EXACT visible tag tokens (never substring/includes).
        const observedTokens = this.formulaAdapter.extractVisibleFormulaTagTokens(t.root)
        const expectedRawNumber = plan?.rawNumber ?? null
        const exactMatchCount = expectedRawNumber
          ? observedTokens.filter(tok => tok === expectedRawNumber).length
          : 0
        const otherTagCount = observedTokens.filter(tok => tok !== expectedRawNumber).length
        const commitState = this.projectionController.commitState(t.root)
        const semanticCommitted = exactMatchCount > 0 && committedForCurrentSignature
        const sequentialCommitted = observedTokens.some(tok => /^\d+$/.test(tok))
        if (sequentialCommitted && semanticCommitted) duplicateVisibleCount++

        // Phase 7R.3.6 §40: exact visible semantic output with a LOST/absent
        // durable commit → adopt the existing output (no rerender) ONLY when
        // every guard holds: connected host / current documentKey / current
        // sourceHash / inkchapter mode / valid authority / exactly one token /
        // exact match / no duplicate.
        const exactVisibleSingleToken =
          observedTokens.length === 1
          && exactMatchCount === 1
          && otherTagCount === 0
          && !sequentialCommitted
          && plan !== undefined
          && plan.documentKey === snap.documentKey
          && t.root.isConnected
          && mode === 'inkchapter'
          && plan.authority === 'inkchapter-native-transient'
        if (!semanticCommitted && exactMatchCount > 0 && !committedForCurrentSignature) {
          this.visibleExactMatchWithNullCommitStateCount++
        }
        if (exactVisibleSingleToken && !committedForCurrentSignature && plan) {
          const adopted = this.projectionController.adoptExistingSemanticOutput(t.root)
          if (adopted) {
            emitRuntimeAudit('FORMULA-VISIBLE-TAG-VERIFY', {
              documentKey: snap.documentKey,
              formulaRuntimeKey: `formula:${t.ordinal}`,
              currentSignatureHash: this.projectionController.currentSignatureHash(t.root),
              lastCommittedSignatureHash: this.projectionController.lastCommittedSignatureHash(t.root),
              expectedRawNumber: expectedRawNumber ?? null,
              observedRawTagTokens: observedTokens,
              exactMatchCount,
              otherTagCount,
              decision: 'ADOPTED_EXISTING_SEMANTIC_OUTPUT',
            })
          }
        }

        const verifyDecision = semanticCommitted
          ? (sequentialCommitted ? 'DUPLICATE_TAGS' : 'EXACT_MATCH')
          : (observedTokens.length === 0 ? 'NO_VISIBLE_TAG' : (committedForCurrentSignature ? 'NO_MATCH' : 'STALE_COMMIT_SIGNATURE'))
        // Phase 7R.3.11.7: identical-state per-formula verify spam emits once.
        emitRuntimeAuditStateDedup(
          'FORMULA-VISIBLE-TAG-VERIFY',
          `${snap.documentKey}|${t.ordinal}|${expectedRawNumber ?? ''}|${observedTokens.join(',')}|${verifyDecision}|${exactMatchCount}|${committedForCurrentSignature}`,
          {
            documentKey: snap.documentKey,
            formulaRuntimeKey: `formula:${t.ordinal}`,
            currentSignatureHash: this.projectionController.currentSignatureHash(t.root),
            currentActivationId: commitState.currentActivationId,
            lastCommittedActivationId: commitState.lastCommittedActivationId,
            lastCommittedSignatureHash: commitState.lastCommittedSignatureHash,
            lastCommittedRawNumber: commitState.lastCommittedRawNumber,
            lastCommittedPlanSetEpoch: commitState.lastCommittedPlanSetEpoch,
            expectedRawNumber: expectedRawNumber ?? null,
            observedRawTagTokens: observedTokens,
            exactMatchCount,
            otherTagCount,
            decision: verifyDecision,
          },
        )

        const formulaDecision = classifyFormulaProjectionVerify({
          planExists: !!plan,
          injected,
          committedForCurrentSignature,
          lookupDecision: lookup,
          semanticCommitted,
          sequentialCommitted,
          customDecorationCount: entry.inkchapterDecorationCount,
        })
        if (formulaDecision === 'SEMANTIC_VISIBLE_VERIFIED') {
          verifiedCount++
          this.projectionController.markCommitted(t.root)
        } else if (plan) {
          falsePositiveGuardCount++
          // Phase 7R.3.6: committed for the current activation but the visible
          // state differs → genuinely stuck (rendered result did not take).
          if (this.projectionController.isCommittedForCurrentSignature(t.root) && observedTokens.length > 0 && exactMatchCount === 0) {
            this.formulaStuckAfterRepeatedToggleCount++
            emitRuntimeAudit('FORMULA-STUCK-DETECTED', {
              documentKey: snap.documentKey,
              formulaRuntimeKey: `formula:${t.ordinal}`,
              expectedRawNumber: expectedRawNumber ?? null,
              observedRawTagTokens: observedTokens,
              decision: 'COMMITTED_BUT_VISIBLE_DIFFERS',
            })
          }
        }
        if (plan && formulaDecision !== 'SEMANTIC_VISIBLE_VERIFIED' && firstPendingReason === null) {
          firstPendingReason = `${formulaDecision}@${`formula:${t.ordinal}`}`
        }
        emitRuntimeAuditStateDedup(
          'FORMULA-PROJECTION-VERIFY-FORMULA',
          `${snap.documentKey}|${t.ordinal}|${desired ?? ''}|${injected}|${lookup ?? ''}|${formulaDecision}`,
          {
            documentKey: snap.documentKey,
            formulaRuntimeKey: `formula:${t.ordinal}`,
            desiredRenderedNumber: desired,
            customDecorationCount: entry.inkchapterDecorationCount,
            injected,
            planLookupDecision: lookup ?? null,
            semanticCommitted,
            sequentialCommitted,
            decision: formulaDecision,
          },
        )
      })
      const aggregateDecision =
        verifiedCount === formulaTargets.length && customDecorationCount === 0 && duplicateVisibleCount === 0
          ? 'SEMANTIC_VISIBLE_VERIFIED'
          : (firstPendingReason ?? 'NO_CUSTOM_OVERLAY_ONLY')
      emitRuntimeAudit('FORMULA-PROJECTION-VERIFY', {
        documentKey: snap.documentKey,
        formulaMode: mode,
        canonicalFormulaTargetCount: formulaTargets.length,
        customDecorationCount,
        duplicateVisibleCount,
        verifiedSemanticCount: verifiedCount,
        falsePositiveGuardCount,
        standardInkchapterCustomDecorationActive: customDecorationCount > 0,
        decision: aggregateDecision,
      })
      // Phase 7R.3.4-A: first semantic commit milestone → finalize the open perf.
      if (verifiedCount > 0) {
        this.perfTracker.mark('T7')
        this.perfTracker.finalize(snap.documentKey)
      }
      this.perfTracker.incFormulaVisibleVerify()
    } catch (error) {
      // Diagnostic failure must NEVER block Formula reconcile.
      emitRuntimeAudit('FORMULA-VISIBLE-PROJECTION-FORENSIC-ERROR', {
        documentKey: snap.documentKey,
        formulaRuntimeKey: 'all',
        errorName: error instanceof Error ? error.name : 'UNKNOWN_ERROR',
        errorMessage: error instanceof Error ? error.message.slice(0, 200) : String(error).slice(0, 200),
        stage: 'emitVisibleProjectionForensic',
        decision: 'FORENSIC_ERROR_IGNORED',
        businessProjectionBlocked: false,
      })
    }
  }

  /** Read MathJax `tex.tags` mode via the bundled MathJax config (read-only). */
  private readMathJaxTagMode(): string | null {
    try {
      const g = globalThis as { MathJax?: { config?: { tex?: { tags?: unknown } } } }
      const tags = g.MathJax?.config?.tex?.tags
      return typeof tags === 'string' ? tags : tags == null ? null : String(tags)
    } catch {
      return null
    }
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

  /**
   * Phase 7R.3.6 final gate: report the atomic-formula gate counters. Emits a
   * bounded PHASE-7R-3-6-GATE-COUNTERS audit and returns the counters for the
   * DevTools probe.
   */
  private formulaGateReport(): Record<string, unknown> {
    const currentPlans = this.lastCompletePlanSet ? this.lastCompletePlanSet.plans.size : 0
    const canonicalHostCount = this.lastFormulaTargets.length
    const stale = this.projectionController.getStaleActivationCounters()
    const report: Record<string, unknown> = {
      documentKey: this.currentDocumentKey ?? null,
      editorStructureEpoch: this.editorStructureEpochValue,
      headingBindingGeneration: this.lastHeadingBindingGeneration,
      planSetEpoch: this.projectionController.getPlanSetEpoch(),
      canonicalFormulaHostCount: canonicalHostCount,
      currentCompletePlanCount: currentPlans,
      transientCandidateDeferCount: this.transientCandidateDeferCount,
      transientIncompletePlanPublishCount: this.transientIncompletePlanPublishCount,
      transientGlobalFallbackProjectionCount: this.transientGlobalFallbackProjectionCount,
      livePlanCountZeroWithoutFormulaDeleteCount: this.livePlanCountZeroWithoutFormulaDeleteCount,
      livePlanCountPartialWithoutFormulaStructureChangeCount: this.livePlanCountPartialWithoutFormulaStructureChangeCount,
      historicalSignatureReactivationBlockCount: this.historicalSignatureReactivationBlockCount,
      skippedSameSignatureBudgetExhaustedCount: this.skippedSameSignatureBudgetExhaustedCount,
      formulaRenderLoopCount: this.formulaRenderLoopCount,
      visibleExactMatchWithNullCommitStateCount: this.visibleExactMatchWithNullCommitStateCount,
      previousSignatureNullOnNonInitialTransitionCount: this.previousSignatureNullOnNonInitialTransitionCount,
      formulaStuckAfterRepeatedToggleCount: this.formulaStuckAfterRepeatedToggleCount,
      staleActivationCommitIgnoredCount: stale.staleActivationCommitIgnoredCount,
      staleActivationLookupCount: stale.staleActivationLookupCount,
      adoptedExistingSemanticOutputCount: stale.adoptedExistingSemanticOutputCount,
      // ── Phase 7R.3.7 caption boundary closure counters ─────────────────
      captionTransientCandidateDeferCount: this.captionTransientCandidateDeferCount,
      captionPartialPlanPublishCount: this.captionPartialPlanPublishCount,
      captionCompletePlanPublishedCount: this.lastCompleteCaptionPlanSet ? this.lastCompleteCaptionPlanSet.states.length : 0,
      decision: 'REPORTED',
    }
    emitRuntimeAudit('PHASE-7R-3-6-GATE-COUNTERS', report)
    emitRuntimeAudit('PHASE-7R-3-7-BOUNDARY-GATE-COUNTERS', {
      documentKey: this.currentDocumentKey ?? null,
      captionTransientGlobalFallbackProjectionCount: this.transientGlobalFallbackProjectionCount,
      captionPartialPlanPublishCount: this.captionPartialPlanPublishCount,
      visibleExactMatchWithNullCommitStateCount: this.visibleExactMatchWithNullCommitStateCount,
      previousSignatureNullOnNonInitialTransitionCount: this.previousSignatureNullOnNonInitialTransitionCount,
      formulaStuckAfterRepeatedToggleCount: this.formulaStuckAfterRepeatedToggleCount,
      formulaRenderLoopCount: this.formulaRenderLoopCount,
      rerenderBudgetAuthority: 'ACTIVATION',
      historicalSignatureIsGatingAuthority: false,
      decision: 'REPORTED',
    })
    emitHeadingSemanticPerfSummary(this.currentDocumentKey)
    return report
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
      // Phase 7R.3.9R: funnel through the coalescing scheduler so this request
      // merges with the concurrent document-open request into ONE reconcile.
      this.requestNumberingReconcile({
        reason: 'rehydrate-empty',
        invalidation: ['HEADING_SEMANTICS_CHANGED', 'OBJECT_STRUCTURE_CHANGED'],
      })
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
      ;(window as any).__inkchapter_formula_gate_report__ = () => this.formulaGateReport()
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
