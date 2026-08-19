/**
 * FormulaStateStore — single authoritative formula state machine.
 *
 * Build ID:     inkchapter-formula-unified-state-machine-exhaustive-matrix-v2.5.7-r5.4.3.15
 * Runtime Mark: FORMULA-UNIFIED-STATE-MACHINE-V2.5.7-R5.4.3.15
 *
 * PRINCIPLES:
 *   1. FormulaStateStore is the SOLE source of truth for formula identity,
 *      numbering, and state. No other module maintains parallel formula truth.
 *   2. CanonicalFormulaSlot identity comes ONLY from structural slot +
 *      operation lineage (NOT from source/hash/sentinel/focus/session).
 *   3. CommittedFormulaDocumentState is immutable once committed.
 *   4. BEFORE state always comes from committed state; AFTER from fresh scan.
 *   5. Two-phase commit: Semantic Commit then Visible Commit.
 *   6. All operations are classified by authoritative delta between before/after.
 *   7. Every managed formula must end with visibleTag === desiredTag.
 *   8. Empty / duplicate-source formulas never participate in identity authority.
 */

import { emitRuntimeAudit } from '../runtime/forensic-log-sink'
import { simpleHash, normalizeTexSource, normalizeTyporaFormulaRenderInput } from './formula-tex-source-verifier'

// ── Build & Runtime Markers ─────────────────────────────────────────────

export const R54315_RUNTIME_MARKER = 'FORMULA-UNIFIED-STATE-MACHINE-V2.5.7-R5.4.3.15'
export const R54315_BUILD_MARKER = 'inkchapter-formula-unified-state-machine-exhaustive-matrix-v2.5.7-r5.4.3.15'

// ── R5.4.3.19: Shared Stable Identity + Source State Types ──────────────

/** Shared business stable identity — MUST never be aliased to host token / -1. */
export type FormulaStableIdentity = string | number

export type FormulaSourceState = 'UNKNOWN' | 'EMPTY' | 'NONEMPTY'

export type FormulaSourceAuthorityKind =
  | 'NONE'
  | 'AUTHORITATIVE_SOURCE'
  | 'TRANSITIONAL_CURRENT_EDIT'
  | 'KNOWN_EMPTY'

export interface FormulaSourceSnapshot {
  sourceState: FormulaSourceState
  sourceAuthorityKind: FormulaSourceAuthorityKind
  authoritativeRawSource: string | null
  authoritativeSourceHash: string | null
  authoritativeSourceRevision: number | null
}

/** R5.4.3.20: result of atomic pre-call structural adoption. */
export interface HostAdoptionResult {
  outcome: 'EXISTING_SLOT' | 'ADOPTED' | 'CONTEXT_NOT_READY' | 'SCAN_FAILED' | 'AMBIGUOUS'
  slot: CanonicalFormulaSlot | null
  addedIdentityCount: number
}

/**
 * R5.4.3.20: PendingSourceReadyProjection — a BLOCKED_SOURCE_NOT_READY
 * projection waiting for the slot's source authority to become ready.
 */
export interface PendingSourceReadyProjection {
  pendingId: string
  originProjectionTransactionId: string
  operationId: string
  documentKey: string
  generation: number
  rootToken: number
  stableIdentity: FormulaStableIdentity
  formulaIndex: number
  canonicalHostToken: number
  canonicalHost: HTMLElement
  blockedStateRevision: number
  blockedDesiredTag: string
  reason: 'SOURCE_NOT_READY'
  status: 'PENDING' | 'SATISFIED_BY_NATURAL_RENDER' | 'REPLAYED' | 'RETIRED'
}

// ── CanonicalFormulaSlot ────────────────────────────────────────────────

/**
 * Each block formula in the document corresponds to exactly one
 * CanonicalFormulaSlot. Identity is derived from structural slot position
 * + operation lineage, NOT from source content, hash, sentinel, focus,
 * session, or reservation.
 */
export interface CanonicalFormulaSlot {
  /** Identity from structural slot + operation lineage. */
  stableIdentity: FormulaStableIdentity

  /** The canonical DOM host element for this formula. */
  canonicalHost: HTMLElement
  /** Monotonically increasing token tied to the host element reference. */
  canonicalHostToken: number
  /**
   * R5.4.3.21 P0-H: structural binding revision — the canonicalHostToken ONLY
   * belongs to the current binding. Typora edit mode (host A → host B) MUST
   * advance bindingRevision while stableIdentity/sourceRevision/desiredTag/
   * formulaIndex stay untouched (STRUCTURAL_HOST_REBIND, never identity churn).
   */
  bindingRevision: number

  /** Identifies the document this slot belongs to. */
  documentKey: string
  /** Document generation counter (increments on document switch). */
  documentGeneration: number
  /** Editor root token to detect root rebind. */
  editorRootToken: number

  /** Order position within the document (0-based, interleaved with headings). */
  documentOrder: number

  /** Scope key (e.g. "chapter-1.section-2.subsection-3"). */
  scopeKey: string
  chapterOrdinal: number | null
  sectionOrdinal: number | null
  subsectionOrdinal: number | null

  /** Sequence value within the scope (1-based, for managed formulas). */
  sequenceValue: number

  /**
   * R5.4.3.19: authoritative source state — NEVER derived from rendered
   * composite text. UNKNOWN ⇒ rawSource=null/ready=false; EMPTY ⇒ rawSource="";
   * NONEMPTY ⇒ exact TeX.
   */
  sourceState: FormulaSourceState
  sourceAuthorityReady: boolean
  sourceAuthorityKind: FormulaSourceAuthorityKind
  /** The authoritative raw TeX source. null when UNKNOWN. */
  authoritativeRawSource: string | null
  /** Hash of the authoritative source (content correlation only, NOT identity). */
  normalizedSourceHash: string
  /** R5.4.3.19: authoritative source hash (for integrity checks). */
  authoritativeSourceHash: string | null
  /** R5.4.3.19: authoritative source revision (advances ONLY on real user edit). */
  authoritativeSourceRevision: number | null

  /** Whether this formula participates in InkChapter numbering. */
  managedForNumbering: boolean

  /** The desired tag computed from ordinal context + sequence. null if unmanaged. */
  desiredTag: string | null

  /** Monotonically increasing revision for semantic changes. */
  semanticRevision: number
  /** Monotonically increasing revision for render/projection changes. */
  renderRevision: number

  /** Current visible projection state. */
  visibleProjectionState:
    | 'UNKNOWN'
    | 'NATIVE_PENDING_REPLACE'
    | 'INKCHAPTER_VISIBLE'
    | 'PROJECTION_PENDING'
    | 'PROJECTION_FAILED'

  /**
   * R5.4.3.18: numbering authority state — separates STRUCTURAL readiness
   * (host/identity/order) from NUMBERING readiness (desiredTag from the
   * authoritative heading/numbering plan) and RENDER authority readiness.
   */
  numberingAuthority: FormulaNumberingAuthorityState
}

/**
 * R5.4.3.18: per-slot numbering authority state.
 * Structural baseline must NOT produce a provisional desiredTag ("1","2").
 */
export interface FormulaNumberingAuthorityState {
  structuralReady: boolean
  headingContextReady: boolean
  numberingPlanReady: boolean
  desiredTagReady: boolean
  headingRevisionUsed: number | null
  numberingPlanRevisionUsed: number | null
  desiredTag: string | null
  renderAuthorityReady: boolean
  authoritySource:
    | 'NONE'
    | 'STRUCTURAL_ONLY'
    | 'LEGACY_NUMBERING_PLAN'
    | 'COMMITTED_NUMBERING_STATE'
}

// ── FormulaOperationKind ────────────────────────────────────────────────

export type FormulaOperationKind =
  | 'NOOP'
  | 'SOURCE_EDIT'
  | 'INSERT_SLOT'
  | 'REMOVE_SLOT'
  | 'REORDER_SLOT'
  | 'MOVE_SCOPE'
  | 'MANAGED_ELIGIBILITY_CHANGE'
  | 'HEADING_TEXT_ONLY'
  | 'HEADING_STRUCTURE_CHANGE'
  | 'NUMBERING_SETTINGS_CHANGE'
  | 'DOCUMENT_SWITCH'
  | 'EDITOR_ROOT_REBIND'
  | 'STRUCTURAL_HOST_REBIND'

// ── FormulaOperationTransaction ─────────────────────────────────────────

export interface FormulaOperationTransaction {
  operationId: string
  mutationBatchId: string

  beforeStateRevision: number

  /** Immutable committed state before the mutation. */
  beforeState: CommittedFormulaDocumentState
  /** Freshly scanned candidate state after the mutation. */
  afterCandidate: CommittedFormulaDocumentState

  operationKind: FormulaOperationKind

  /** Identities that appear in after but not in before. */
  addedStableIdentities: Array<string | number>
  /** Identities that appear in before but not in after. */
  removedStableIdentities: Array<string | number>
  /** Identities that appear in both before and after. */
  survivingStableIdentities: Array<string | number>

  /** Primary identity of interest (e.g. the inserted/removed/moved slot). */
  primaryStableIdentity: string | number | null

  /** Dependency frontier computed from the classified operation. */
  dependencyFrontier: FormulaDependencyFrontier | null

  /** All identities whose desiredTag may have changed. */
  affectedStableIdentities: Array<string | number>

  /** The revision number this transaction targets (beforeRevision + 1 for semantic ops). */
  targetStateRevision: number

  status:
    | 'CAPTURED'
    | 'AFTER_SCANNED'
    | 'CLASSIFIED'
    | 'SEMANTIC_COMMITTED'
    | 'PROJECTION_DISPATCHED'
    | 'VISIBLE_COMMITTED'
    | 'FAILED'
}

// ── FormulaRenderTransaction ────────────────────────────────────────────

/**
 * Immutable view of a committed slot for a single render call.
 * This is NOT a parallel semantic authority — it is a DERIVED VIEW.
 */
export interface FormulaRenderTransaction {
  renderTransactionId: string
  stateRevision: number

  stableIdentity: string | number
  canonicalHost: HTMLElement
  canonicalHostToken: number

  formulaIndex: number

  sourceState: FormulaSourceState
  rawSource: string

  desiredTag: string

  operationId: string | null
}

// ── FormulaProjectionTransaction ────────────────────────────────────────

/**
 * Persistent identity through the async projection pipeline.
 * stableIdentity must remain the same from dispatch → fulfillment → commit → verify.
 */
export interface FormulaProjectionTransaction {
  projectionTransactionId: string
  operationId: string
  targetStateRevision: number

  stableIdentity: FormulaStableIdentity
  formulaIndex: number

  canonicalHost: HTMLElement
  canonicalHostToken: number

  desiredTag: string
  /** R5.4.3.19: FROZEN authoritative raw source snapshot at creation time. */
  rawSource: string
  sourceState: FormulaSourceState
  authoritativeSourceHash: string | null
  authoritativeSourceRevision: number | null

  compositeOwner: HTMLElement | null
  previewHost: HTMLElement | null
  oldNativeMjx: HTMLElement | null

  /** R5.4.3.19: native DOM mutation is allowed AT MOST ONCE per transaction. */
  nativeDomMutationCount: number

  status:
    | 'CREATED'
    | 'FULFILLMENT_PENDING'
    | 'FULFILLED'
    | 'DOM_REPLACE_PENDING'
    | 'DOM_REPLACED'
    | 'VISIBLE_VERIFIED'
    | 'FAILED'
    | 'STALE'
    | 'BLOCKED_SOURCE_NOT_READY'
}

// ── FormulaDependencyFrontier ───────────────────────────────────────────

/**
 * Dependency frontier computed from a classified operation.
 * Only created from authoritative operation classification, NOT from event hints.
 */
export interface FormulaDependencyFrontier {
  frontierId: string
  operationKind: FormulaOperationKind
  startDocumentOrder: number
  endDocumentOrder: number
  oldScopeKeys: string[]
  newScopeKeys: string[]
  affectedStableIdentities: Array<string | number>
}

// ── CommittedFormulaDocumentState ───────────────────────────────────────

/**
 * Immutable committed document state.
 * Once committed, this object is NEVER mutated — a new state is created instead.
 */
export interface CommittedFormulaDocumentState {
  stateRevision: number
  documentKey: string
  documentGeneration: number
  editorRootToken: number
  headingStateRevision: number
  slotsInDocumentOrder: CanonicalFormulaSlot[]
  slotByStableIdentity: Map<string | number, CanonicalFormulaSlot>
  semanticSignature: string
  committedAtOperationId: string | null

  /** R5.4.3.18: store-level numbering readiness. */
  structuralReady: boolean
  managedSlotCount: number
  desiredTagReadyCount: number
  allManagedDesiredTagsReady: boolean
  headingRevisionUsed: number | null
  numberingPlanRevisionUsed: number | null
  renderAuthorityReady: boolean
}

// ── OperationClosure ────────────────────────────────────────────────────

export interface FormulaOperationClosure {
  operationId: string
  operationKind: FormulaOperationKind
  targetStateRevision: number
  semanticCommitted: boolean
  affectedCount: number
  projectionRequestedCount: number
  projectionSettledCount: number
  projectionCommittedCount: number
  visibleVerifiedCount: number
  nativeManagedMismatchCount: number
  pendingProjectionCount: number
  failedProjectionCount: number
  /** R5.4.3.20: BLOCKED_SOURCE_NOT_READY targets awaiting source authority. */
  pendingSourceReadyCount: number
  allDesiredTagsVisible: boolean
  decision: 'PASS' | 'FAIL' | 'PARTIAL'
  reason: string | null
}

// ── Identity Authority Invariant ────────────────────────────────────────

/**
 * Identity Authority Invariant marker data.
 * Only STRUCTURAL_SLOT and OPERATION_LINEAGE grant identityAuthorityValid=true.
 */
export interface IdentityAuthorityInvariant {
  stableIdentity: string | number | null
  canonicalHostToken: number | null
  identitySource:
    | 'STRUCTURAL_SLOT'
    | 'OPERATION_LINEAGE'
    | 'SOURCE_MATCH'
    | 'SOURCE_HASH'
    | 'EMPTY_SENTINEL'
    | 'CURRENT_FOCUS'
    | 'EDIT_SESSION'
    | 'FALLBACK'
  identityAuthorityValid: boolean
  decision: 'PASS' | 'FAIL'
  reason: string | null
}

// ── Identity Authority Check ────────────────────────────────────────────

/**
 * Check that a stable identity was derived from an authoritative source.
 * Only STRUCTURAL_SLOT and OPERATION_LINEAGE pass.
 * EMPTY_SENTINEL, SOURCE_MATCH, SOURCE_HASH, CURRENT_FOCUS, EDIT_SESSION, FALLBACK all FAIL.
 */
export function checkIdentityAuthorityInvariant(
  stableIdentity: string | number | null,
  canonicalHostToken: number | null,
  identitySource: IdentityAuthorityInvariant['identitySource'],
): IdentityAuthorityInvariant {
  const validSources: IdentityAuthorityInvariant['identitySource'][] = [
    'STRUCTURAL_SLOT',
    'OPERATION_LINEAGE',
  ]
  const identityAuthorityValid = validSources.includes(identitySource)

  let decision: 'PASS' | 'FAIL'
  let reason: string | null

  if (identityAuthorityValid) {
    decision = 'PASS'
    reason = null
  } else {
    decision = 'FAIL'
    reason = `IDENTITY_SOURCE_IS_NOT_AUTHORITATIVE: source=${identitySource}`
  }

  // EMPTY_SENTINEL is always a hard fail
  if (identitySource === 'EMPTY_SENTINEL') {
    decision = 'FAIL'
    reason = 'EMPTY_SENTINEL_IS_NEVER_IDENTITY_AUTHORITY'
  }

  // SOURCE_MATCH with null/undefined stableIdentity is also a fail
  if (identitySource === 'SOURCE_MATCH' && stableIdentity === null) {
    decision = 'FAIL'
    reason = 'SOURCE_MATCH_WITH_NULL_IDENTITY'
  }

  const invariant: IdentityAuthorityInvariant = {
    stableIdentity,
    canonicalHostToken,
    identitySource,
    identityAuthorityValid,
    decision,
    reason,
  }

  emitRuntimeAudit('FORMULA-IDENTITY-AUTHORITY-INVARIANT', {
    stableIdentity,
    canonicalHostToken,
    identitySource,
    identityAuthorityValid,
    decision,
    reason,
    runtimeMarker: R54315_RUNTIME_MARKER,
  })

  return invariant
}

// ── Internal Helpers ────────────────────────────────────────────────────

let _operationCounter = 0
let _projectionCounter = 0
let _frontierCounter = 0

function nextOperationId(): string {
  _operationCounter++
  return `op-${_operationCounter}-${Date.now()}`
}

function nextProjectionTransactionId(): string {
  _projectionCounter++
  return `proj-${_projectionCounter}-${Date.now()}`
}

function nextFrontierId(): string {
  _frontierCounter++
  return `frontier-${_frontierCounter}-${Date.now()}`
}

function computeSemanticSignature(slots: CanonicalFormulaSlot[]): string {
  // Build a deterministic signature from slot identities + document order + desiredTag
  const parts: string[] = []
  for (const slot of slots) {
    parts.push(`${slot.stableIdentity}:${slot.documentOrder}:${slot.desiredTag ?? ''}:${slot.sourceState}:${slot.managedForNumbering}`)
  }
  // Simple hash — stable for same slot sequence
  let hash = 0
  const str = parts.join('|')
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i)
    hash = ((hash << 5) - hash) + char
    hash = hash & hash // Convert to 32-bit integer
  }
  return `sig-${Math.abs(hash).toString(36)}`
}

/**
 * R5.4.3.18: compute store-level numbering readiness from slots.
 * renderAuthorityReady requires: structuralReady && ALL managed slots have a
 * non-null desiredTag && headingRevisionUsed != null && numberingPlanRevisionUsed != null.
 */
export function computeStateNumberingReadiness(
  slots: CanonicalFormulaSlot[],
  headingRevisionUsed: number | null,
  numberingPlanRevisionUsed: number | null,
): {
  structuralReady: boolean
  managedSlotCount: number
  desiredTagReadyCount: number
  allManagedDesiredTagsReady: boolean
  renderAuthorityReady: boolean
} {
  const managed = slots.filter((s) => s.managedForNumbering)
  // R5.4.3.18: a desiredTag only counts as READY when the slot's numbering
  // authority flags it ready (provisional/structural-only tags never count).
  const desiredTagReady = managed.filter((s) => {
    if (s.numberingAuthority && s.numberingAuthority.desiredTagReady !== undefined) {
      return s.numberingAuthority.desiredTagReady && s.desiredTag !== null && s.desiredTag !== ''
    }
    return s.desiredTag !== null && s.desiredTag !== ''
  })
  const structuralReady = slots.length > 0
    ? slots.every((s) => s.canonicalHost !== null && s.stableIdentity !== null && s.stableIdentity !== '')
    : true
  const allManagedDesiredTagsReady = managed.length > 0 ? desiredTagReady.length === managed.length : true
  const renderAuthorityReady = structuralReady
    && allManagedDesiredTagsReady
    && headingRevisionUsed !== null
    && numberingPlanRevisionUsed !== null
  return {
    structuralReady,
    managedSlotCount: managed.length,
    desiredTagReadyCount: desiredTagReady.length,
    allManagedDesiredTagsReady,
    renderAuthorityReady,
  }
}

/** R5.4.3.18: build the store-level readiness fields for a state object. */
function buildStateReadiness(
  slots: CanonicalFormulaSlot[],
  headingRevisionUsed: number | null,
  numberingPlanRevisionUsed: number | null,
): Pick<
  CommittedFormulaDocumentState,
  'structuralReady' | 'managedSlotCount' | 'desiredTagReadyCount' | 'allManagedDesiredTagsReady' | 'headingRevisionUsed' | 'numberingPlanRevisionUsed' | 'renderAuthorityReady'
> {
  const r = computeStateNumberingReadiness(slots, headingRevisionUsed, numberingPlanRevisionUsed)
  return {
    structuralReady: r.structuralReady,
    managedSlotCount: r.managedSlotCount,
    desiredTagReadyCount: r.desiredTagReadyCount,
    allManagedDesiredTagsReady: r.allManagedDesiredTagsReady,
    headingRevisionUsed,
    numberingPlanRevisionUsed,
    renderAuthorityReady: r.renderAuthorityReady,
  }
}

function computeNormalizedSourceHash(source: string): string {
  let hash = 0
  const normalized = source.trim().replace(/\s+/g, ' ')
  for (let i = 0; i < normalized.length; i++) {
    const char = normalized.charCodeAt(i)
    hash = ((hash << 5) - hash) + char
    hash = hash & hash
  }
  return `h-${Math.abs(hash).toString(36)}`
}

function computeDocumentOrder(element: HTMLElement, editorRoot: HTMLElement): number {
  // Walk the DOM tree to compute the document order position.
  // This is a simplified implementation — in production, use TreeWalker or
  // a more robust traversal.
  let order = 0
  const walker = document.createTreeWalker(
    editorRoot,
    NodeFilter.SHOW_ELEMENT,
    null,
  )
  let node: Node | null = walker.firstChild()
  while (node) {
    if (node === element) {
      return order
    }
    if ((node as HTMLElement).matches?.(
      '.md-block-formula, .md-math-block, .MathJax_Display, ' +
      '[data-formula-host], .typora-math-block',
    )) {
      order++
    }
    node = walker.nextNode()
  }
  return order
}

/**
 * R5.4.3.17: SAFE class access — Element.className is NOT guaranteed to be a
 * string (SVGElement exposes SVGAnimatedString). Prefer getAttribute('class').
 * Any non-string className MUST never throw.
 */
export function safeClassName(el: Element): string {
  try {
    if (typeof (el as { className?: unknown }).className === 'string') {
      return (el as { className: string }).className
    }
  } catch { /* non-string className */ }
  try {
    return el.getAttribute('class') ?? ''
  } catch { /* attribute read failed */ }
  return ''
}

/** Reject MathJax internal / SVG / inline / disconnected nodes entirely. */
function isRejectedMathInternalNode(el: Element): boolean {
  const tag = el.tagName
  if (tag === 'MJX-CONTAINER' || tag === 'MJX-MATH' || tag === 'MJX-MROW' || tag === 'SVG' || tag === 'MATH') {
    return true
  }
  if (tag.startsWith('MJX-')) return true
  return false
}

function isFormulaHostElement(el: Element): boolean {
  try {
    if (isRejectedMathInternalNode(el)) return false
    if (!(el instanceof HTMLElement)) return false
    if (el.closest('.CodeMirror')) return false
    if (el.tagName === 'SPAN' || el.classList.contains('md-math')) return false
    const tag = el.tagName.toLowerCase()
    const cls = safeClassName(el).toLowerCase()
    return (
      (tag === 'figure' && cls.includes('math')) ||
      cls.includes('md-block-formula') ||
      cls.includes('md-math-block') ||
      cls.includes('mathjax_display') ||
      el.hasAttribute?.('data-formula-host') ||
      cls.includes('typora-math-block')
    )
  } catch {
    return false
  }
}

/**
 * R5.4.3.19: STRICT source extraction barrier — composite host.textContent
 * (Typora UI "公式" text, old tags, MJX rendered body) MUST NEVER become an
 * authoritative TeX source. Only explicit source representations qualify.
 * Returns null when no authoritative source is determinable (→ UNKNOWN).
 */
function extractFormulaSource(host: HTMLElement): string | null {
  try {
    const dataSrc = host.getAttribute?.('data-tex') ?? host.getAttribute?.('data-source')
    if (dataSrc) return dataSrc
  } catch { /* read-only */ }
  try {
    const sourceInput = host.querySelector<HTMLTextAreaElement | HTMLInputElement>(
      'textarea, input[type="text"]',
    )
    if (sourceInput?.value) return sourceInput.value
  } catch { /* read-only */ }
  try {
    const scriptSource = host.querySelector('script[type="math/tex"], script[type="math/tex; mode=display"]')
    if (scriptSource?.textContent) return scriptSource.textContent.trim()
  } catch { /* read-only */ }
  try {
    const pre = host.querySelector('pre')
    const fromPre = pre?.textContent?.trim()
    if (fromPre && fromPre.length > 0) return fromPre
  } catch { /* read-only */ }
  try {
    const container = host.querySelector('.md-rawblock-container, .md-math-container')
    const fromContainer = container?.textContent?.trim()
    if (fromContainer && fromContainer.length > 0) return fromContainer
  } catch { /* read-only */ }
  // HARD BARRIER: never fall back to host.textContent.
  return null
}

function isFormulaEmptySource(source: string | null): boolean {
  if (source === null) return false // UNKNOWN is not EMPTY
  const trimmed = source.trim()
  if (trimmed === '') return true
  // <Empty Math Block> sentinel is NEVER stored as real TeX — treat as empty.
  if (/^<Empty\s+Math\s+Block>$/i.test(trimmed)) return true
  if (/^<Empty\s+Block>$/i.test(trimmed)) return true
  if (/^\\space(\s|$)/.test(trimmed)) return true
  return false
}
export { isFormulaEmptySource }

function resolveScopeKey(
  host: HTMLElement,
  editorRoot: HTMLElement,
  headings: HeadingInfo[],
  documentOrder: number,
): {
  scopeKey: string
  chapterOrdinal: number | null
  sectionOrdinal: number | null
  subsectionOrdinal: number | null
} {
  // Find the nearest preceding heading to determine scope
  let bestHeading: HeadingInfo | null = null
  for (const h of headings) {
    if (h.blockOrder <= documentOrder) {
      bestHeading = h
    } else {
      break
    }
  }

  if (!bestHeading) {
    return { scopeKey: 'global', chapterOrdinal: null, sectionOrdinal: null, subsectionOrdinal: null }
  }

  const chapterOrdinal = bestHeading.chapterOrdinal ?? null
  const sectionOrdinal = bestHeading.level >= 2 ? bestHeading.sectionOrdinal ?? null : null
  const subsectionOrdinal = bestHeading.level >= 3 ? bestHeading.subsectionOrdinal ?? null : null

  const parts: string[] = []
  if (chapterOrdinal !== null) parts.push(`ch-${chapterOrdinal}`)
  if (sectionOrdinal !== null) parts.push(`sec-${sectionOrdinal}`)
  if (subsectionOrdinal !== null) parts.push(`sub-${subsectionOrdinal}`)

  return {
    scopeKey: parts.length > 0 ? parts.join('.') : 'global',
    chapterOrdinal,
    sectionOrdinal,
    subsectionOrdinal,
  }
}

// ── HeadingInfo (simplified heading structure) ─────────────────────────

interface HeadingInfo {
  level: number
  blockOrder: number
  chapterOrdinal: number | null
  sectionOrdinal: number | null
  subsectionOrdinal: number | null
  text: string
}

// ── FormulaRuntimeContext ───────────────────────────────────────────────

/**
 * R5.4.3.17: The authoritative runtime context the FormulaStateStore must bind
 * to. NEVER guessed by the store — always provided by CaptionService.
 */
export interface FormulaRuntimeContext {
  documentKey: string
  documentGeneration: number
  editorRoot: HTMLElement
  editorRootToken: number
}

/** R5.4.3.17: check runtime context ready hard gate. */
export function isRuntimeContextReady(ctx: FormulaRuntimeContext): { ready: boolean; reason: string | null } {
  if (!ctx || typeof ctx !== 'object') {
    return { ready: false, reason: 'CONTEXT_OBJECT_MISSING' }
  }
  if (typeof ctx.documentKey !== 'string' || ctx.documentKey === '') {
    return { ready: false, reason: 'RUNTIME_CONTEXT_NOT_READY:documentKey_empty' }
  }
  if (typeof ctx.documentGeneration !== 'number' || ctx.documentGeneration <= 0) {
    return { ready: false, reason: 'RUNTIME_CONTEXT_NOT_READY:generation_zero' }
  }
  if (!(ctx.editorRoot instanceof HTMLElement)) {
    return { ready: false, reason: 'RUNTIME_CONTEXT_NOT_READY:editorRoot_not_htmlelement' }
  }
  if (!ctx.editorRoot.isConnected) {
    return { ready: false, reason: 'RUNTIME_CONTEXT_NOT_READY:editorRoot_disconnected' }
  }
  if (typeof ctx.editorRootToken !== 'number' || ctx.editorRootToken <= 0) {
    return { ready: false, reason: 'RUNTIME_CONTEXT_NOT_READY:rootToken_zero' }
  }
  return { ready: true, reason: null }
}

// ── FormulaStateStore ───────────────────────────────────────────────────

/**
 * FormulaStateStore — the single authoritative store for all formula identity,
 * numbering, and state within a document.
 *
 * USAGE:
 *   const store = getFormulaStateStore()
 *   const before = store.captureBeforeState()
 *   // ... perform DOM mutation ...
 *   const after = store.scanAfterCandidate(editorRoot, headings)
 *   const { operationKind, addedIdentities, removedIdentities, survivingIdentities } =
 *     store.classifyOperation(before, after)
 *   const frontier = store.computeDependencyFrontier(
 *     operationKind, addedIdentities, removedIdentities, survivingIdentities, before, after
 *   )
 *   const tx: FormulaOperationTransaction = {
 *     operationId: nextOperationId(),
 *     mutationBatchId: '...',
 *     beforeStateRevision: before.stateRevision,
 *     beforeState: before,
 *     afterCandidate: after,
 *     operationKind,
 *     addedStableIdentities: addedIdentities,
 *     removedStableIdentities: removedIdentities,
 *     survivingStableIdentities: survivingIdentities,
 *     primaryStableIdentity: addedIdentities[0] ?? removedIdentities[0] ?? null,
 *     dependencyFrontier: frontier,
 *     affectedStableIdentities: [...addedIdentities, ...removedIdentities, ...survivingIdentities],
 *     targetStateRevision: before.stateRevision + 1,
 *     status: 'CLASSIFIED',
 *   }
 *   const { newState } = store.commitOperation(tx)
 */
export class FormulaStateStore {
  private _currentRevision = 0
  private _committedState: CommittedFormulaDocumentState | null = null
  private readonly _documentStates: Map<number, CommittedFormulaDocumentState> = new Map()
  private readonly _pendingTransactions: Map<string, FormulaOperationTransaction> = new Map()
  private readonly _projectionTransactions: Map<string, FormulaProjectionTransaction> = new Map()
  /** R5.4.3.20: BLOCKED_SOURCE_NOT_READY → source-ready replay registry. */
  private readonly _pendingSourceReadyProjections: Map<string, PendingSourceReadyProjection> = new Map()
  private _documentKey: string = ''
  private _documentGeneration: number = 0
  private _editorRootToken: number = 0
  private _headingStateRevision: number = 0
  /**
   * R5.4.3.21 P0-H: persistent structural-slot identity counter. A NEW slot's
   * stableIdentity is `${docKey}:${gen}:${rootToken}:structural-${n}` — NEVER
   * aliased to the ephemeral canonicalHostToken (host token belongs to the
   * current binding / bindingRevision only).
   */
  private _slotIdentityCounter = 0

  // ── Public accessors ──────────────────────────────────────────────────

  get currentRevision(): number {
    return this._currentRevision
  }

  get committedState(): CommittedFormulaDocumentState | null {
    return this._committedState
  }

  /** Get the current committed state (throws if no committed state exists). */
  getCurrentCommittedState(): CommittedFormulaDocumentState {
    if (!this._committedState) {
      throw new Error(
        'FormulaStateStore: No committed state available. ' +
        'Must initialize with captureBeforeState or commitOperation first.',
      )
    }
    return this._committedState
  }

  // ── R5.4.3.17: Runtime Context Binding ────────────────────────────────

  /**
   * Bind the authoritative runtime context. Hard gate: only binds when
   * documentKey non-empty, generation>0, editorRoot connected, rootToken>0.
   * Emits FORMULA-STATE-RUNTIME-CONTEXT-AUTHORITY. Returns true on PASS.
   */
  bindRuntimeContext(ctx: FormulaRuntimeContext): boolean {
    const gate = isRuntimeContextReady(ctx)
    const sameDocument = this._documentKey === ctx.documentKey
    const sameGeneration = this._documentGeneration === ctx.documentGeneration
    const sameRoot = this._editorRootToken === ctx.editorRootToken
    emitRuntimeAudit('FORMULA-STATE-RUNTIME-CONTEXT-AUTHORITY', {
      reason: 'bindRuntimeContext',
      documentKey: ctx.documentKey,
      documentGeneration: ctx.documentGeneration,
      editorRootToken: ctx.editorRootToken,
      editorRootConnected: ctx.editorRoot.isConnected,
      editorRootTag: ctx.editorRoot.tagName,
      workspaceDocumentKey: ctx.documentKey,
      serviceDocumentKey: ctx.documentKey,
      sameDocument,
      sameGeneration,
      sameRoot,
      decision: gate.ready ? 'PASS' : 'FAIL',
      failureReason: gate.reason,
      runtimeMarker: R54315_RUNTIME_MARKER,
    })
    if (!gate.ready) return false
    this._documentKey = ctx.documentKey
    this._documentGeneration = ctx.documentGeneration
    this._editorRootToken = ctx.editorRootToken
    return true
  }

  /** True when the store baseline is committed for the given context. */
  isBaselineReadyFor(documentKey: string, generation: number, rootToken: number): boolean {
    if (!this._committedState) return false
    return this._documentKey === documentKey
      && this._documentGeneration === generation
      && this._editorRootToken === rootToken
      && this._committedState.slotsInDocumentOrder.length >= 0
  }

  /** R5.4.3.17: lookup committed slot by canonical host (=== containment-safe). */
  lookupCommittedSlotByHost(host: HTMLElement): CanonicalFormulaSlot | null {
    if (!this._committedState || !host) return null
    for (const slot of this._committedState.slotsInDocumentOrder) {
      if (slot.canonicalHost === host) return slot
    }
    // Fallback: host may be an inner element of the canonical host.
    for (const slot of this._committedState.slotsInDocumentOrder) {
      const ch = slot.canonicalHost
      if (ch === host || ch.contains(host) || host.contains(ch)) return slot
    }
    return null
  }

  get documentKey(): string { return this._documentKey }
  get documentGeneration(): number { return this._documentGeneration }
  get editorRootToken(): number { return this._editorRootToken }

  // ── captureBeforeState ────────────────────────────────────────────────

  /**
   * Capture the current committed state as the BEFORE state.
   * Returns the immutable committed state.
   * IMPORTANT: BEFORE must always come from committed state, never from a fresh scan.
   */
  captureBeforeState(): CommittedFormulaDocumentState {
    if (!this._committedState) {
      // Create an empty initial committed state
      const emptyState = this._createEmptyState()
      this._committedState = emptyState
      this._documentStates.set(emptyState.stateRevision, emptyState)

      emitRuntimeAudit('FORMULA-STATE-STORE-COMMITTED-STATE', {
        stateRevision: emptyState.stateRevision,
        documentKey: emptyState.documentKey,
        documentGeneration: emptyState.documentGeneration,
        editorRootToken: emptyState.editorRootToken,
        slotCount: 0,
        semanticSignature: emptyState.semanticSignature,
        action: 'INITIALIZED_EMPTY',
        runtimeMarker: R54315_RUNTIME_MARKER,
      })
    }

    emitRuntimeAudit('FORMULA-STATE-STORE-COMMITTED-STATE', {
      stateRevision: this._committedState.stateRevision,
      documentKey: this._committedState.documentKey,
      documentGeneration: this._committedState.documentGeneration,
      editorRootToken: this._committedState.editorRootToken,
      slotCount: this._committedState.slotsInDocumentOrder.length,
      semanticSignature: this._committedState.semanticSignature,
      action: 'CAPTURE_BEFORE',
      runtimeMarker: R54315_RUNTIME_MARKER,
    })

    return this._committedState
  }

  // ── scanAfterCandidate ────────────────────────────────────────────────

  /**
   * Scan the editor root DOM to build a fresh candidate state.
   * This is the AFTER state — never used as BEFORE.
   *
   * R5.4.3.17: context must be bound first (documentKey non-empty, generation>0,
   * rootToken>0). Returns null when context is not ready — never commits an
   * empty-context baseline.
   *
   * @param editorRoot - The editor root HTMLElement to scan.
   * @param headings - Array of heading info for scope resolution.
   */
  scanAfterCandidate(
    editorRoot: HTMLElement,
    headings: HeadingInfo[],
    sourceSnapshots?: Map<HTMLElement, FormulaSourceSnapshot>,
  ): CommittedFormulaDocumentState | null {
    if (!this._contextBound()) {
      emitRuntimeAudit('FORMULA-STATE-RUNTIME-CONTEXT-AUTHORITY', {
        reason: 'scanAfterCandidate',
        documentKey: this._documentKey,
        documentGeneration: this._documentGeneration,
        editorRootToken: this._editorRootToken,
        decision: 'FAIL',
        failureReason: 'RUNTIME_CONTEXT_NOT_READY:store_not_bound',
        runtimeMarker: R54315_RUNTIME_MARKER,
      })
      return null
    }
    const slots = this._scanFormulaSlots(editorRoot, headings, sourceSnapshots)
    const slotMap = new Map<string | number, CanonicalFormulaSlot>()
    for (const slot of slots) {
      slotMap.set(slot.stableIdentity, slot)
    }

    const candidateRevision = this._currentRevision + 1
    const semanticSignature = computeSemanticSignature(slots)

    const state: CommittedFormulaDocumentState = {
      stateRevision: candidateRevision,
      documentKey: this._documentKey,
      documentGeneration: this._documentGeneration,
      editorRootToken: this._editorRootToken,
      headingStateRevision: this._headingStateRevision,
      slotsInDocumentOrder: slots,
      slotByStableIdentity: slotMap,
      semanticSignature,
      committedAtOperationId: null,
      ...buildStateReadiness(slots, null, null),
    }

    // Emit after-candidate audit
    emitRuntimeAudit('FORMULA-STATE-STORE-COMMITTED-STATE', {
      stateRevision: candidateRevision,
      documentKey: state.documentKey,
      documentGeneration: state.documentGeneration,
      editorRootToken: state.editorRootToken,
      slotCount: slots.length,
      semanticSignature,
      slotIdentities: slots.map((s) => s.stableIdentity),
      sourceStates: slots.map((s) => s.sourceState),
      scopeKeys: slots.map((s) => s.scopeKey),
      action: 'SCAN_AFTER_CANDIDATE',
      runtimeMarker: R54315_RUNTIME_MARKER,
    })

    return state
  }

  // ── buildAfterCandidateState (alias for scanAfterCandidate) ───────────

  /**
   * Build an after-candidate state by scanning the editorRoot DOM.
   * Delegates to scanAfterCandidate.
   */
  buildAfterCandidateState(
    editorRoot: HTMLElement,
    headings: HeadingInfo[],
    sourceSnapshots?: Map<HTMLElement, FormulaSourceSnapshot>,
  ): CommittedFormulaDocumentState | null {
    return this.scanAfterCandidate(editorRoot, headings, sourceSnapshots)
  }

  /**
   * R5.4.3.17: Build a candidate state from an ALREADY-COLLECTED canonical
   * host list (the production FormulaAdapter collector result). Never uses a
   * TreeWalker guess over the whole editor DOM.
   *
   * @param canonicalHosts - canonical block formula hosts in document order
   * @param headings - heading info for scope resolution
   * @param context - the authoritative runtime context (or null to reuse bound)
   * @param desiredTagOverrides - trusted desiredTag per host (from the working
   *   production numbering pipeline); keeps store desiredTag aligned with it
   */
  buildStateFromCanonicalHosts(
    canonicalHosts: HTMLElement[],
    headings: HeadingInfo[],
    context: FormulaRuntimeContext | null,
    desiredTagOverrides?: Map<HTMLElement, string | null>,
    sourceSnapshots?: Map<HTMLElement, FormulaSourceSnapshot>,
  ): CommittedFormulaDocumentState | null {
    if (context && !this.bindRuntimeContext(context)) return null
    if (!this._contextBound()) {
      emitRuntimeAudit('FORMULA-STATE-RUNTIME-CONTEXT-AUTHORITY', {
        reason: 'buildStateFromCanonicalHosts',
        documentKey: this._documentKey,
        documentGeneration: this._documentGeneration,
        editorRootToken: this._editorRootToken,
        decision: 'FAIL',
        failureReason: 'RUNTIME_CONTEXT_NOT_READY:store_not_bound',
        runtimeMarker: R54315_RUNTIME_MARKER,
      })
      return null
    }
    const slots = this._slotsFromHosts(canonicalHosts, headings, desiredTagOverrides, sourceSnapshots)
    const slotMap = new Map<string | number, CanonicalFormulaSlot>()
    for (const slot of slots) {
      slotMap.set(slot.stableIdentity, slot)
    }
    const candidateRevision = this._currentRevision + 1
    const semanticSignature = computeSemanticSignature(slots)
    const state: CommittedFormulaDocumentState = {
      stateRevision: candidateRevision,
      documentKey: this._documentKey,
      documentGeneration: this._documentGeneration,
      editorRootToken: this._editorRootToken,
      headingStateRevision: this._headingStateRevision,
      slotsInDocumentOrder: slots,
      slotByStableIdentity: slotMap,
      semanticSignature,
      committedAtOperationId: null,
      ...buildStateReadiness(slots, null, null),
    }
    emitRuntimeAudit('FORMULA-STATE-STORE-COMMITTED-STATE', {
      stateRevision: candidateRevision,
      documentKey: state.documentKey,
      documentGeneration: state.documentGeneration,
      editorRootToken: state.editorRootToken,
      slotCount: slots.length,
      semanticSignature,
      slotIdentities: slots.map((s) => s.stableIdentity),
      desiredTags: slots.map((s) => s.desiredTag),
      action: 'SCAN_FROM_CANONICAL_HOSTS',
      runtimeMarker: R54315_RUNTIME_MARKER,
    })
    return state
  }

  private _contextBound(): boolean {
    return this._documentKey !== '' && this._documentGeneration > 0 && this._editorRootToken > 0
  }

  // ── classifyOperation ─────────────────────────────────────────────────

  /**
   * Classify the operation based on the authoritative delta between before and after.
   *
   * HARD GATES:
   *   - INSERT_SLOT: afterIdentityCount == beforeIdentityCount + 1, addedStableIdentities.length == 1
   *   - REMOVE_SLOT: beforeIdentityCount == afterIdentityCount + 1, removedStableIdentities.length == 1
   *   - REORDER_SLOT: identity set before == identity set after but order changed
   *   - SOURCE_EDIT: identity/order/scope unchanged, only source changed
   *   - Empty sentinel identity source -> FAIL
   *   - Duplicate source hash -> sourceMatchIsUnique=false
   */
  classifyOperation(
    before: CommittedFormulaDocumentState,
    after: CommittedFormulaDocumentState,
  ): {
    operationKind: FormulaOperationKind
    addedIdentities: Array<string | number>
    removedIdentities: Array<string | number>
    survivingIdentities: Array<string | number>
  } {
    // Validate before/after object references
    if (before === after) {
      emitRuntimeAudit('FORMULA-OPERATION-BEFORE-AFTER-AUTHORITY', {
        operationId: null,
        beforeRevision: before.stateRevision,
        afterCandidateRevision: after.stateRevision,
        sameObjectReference: true,
        decision: 'FAIL',
        reason: 'BEFORE_AND_AFTER_ARE_SAME_OBJECT',
        runtimeMarker: R54315_RUNTIME_MARKER,
      })
      return {
        operationKind: 'NOOP',
        addedIdentities: [],
        removedIdentities: [],
        survivingIdentities: [...before.slotByStableIdentity.keys()],
      }
    }

    const beforeIdentities = new Set(before.slotByStableIdentity.keys())
    const afterIdentities = new Set(after.slotByStableIdentity.keys())

    const addedIdentities: Array<string | number> = []
    const removedIdentities: Array<string | number> = []
    const survivingIdentities: Array<string | number> = []

    for (const id of afterIdentities) {
      if (!beforeIdentities.has(id)) {
        addedIdentities.push(id)
      } else {
        survivingIdentities.push(id)
      }
    }
    for (const id of beforeIdentities) {
      if (!afterIdentities.has(id)) {
        removedIdentities.push(id)
      }
    }

    // Remove surviving identities that were also added/removed (shouldn't happen, but be safe)
    const survivingSet = new Set(survivingIdentities)
    for (const id of addedIdentities) survivingSet.delete(id)
    for (const id of removedIdentities) survivingSet.delete(id)
    const finalSurviving = [...survivingSet]

    const beforeIdentityCount = beforeIdentities.size
    const afterIdentityCount = afterIdentities.size

    // Emit before/after authority marker
    emitRuntimeAudit('FORMULA-OPERATION-BEFORE-AFTER-AUTHORITY', {
      operationId: null,
      beforeRevision: before.stateRevision,
      afterCandidateRevision: after.stateRevision,
      beforeIdentityCount,
      afterIdentityCount,
      beforeIdentities: [...beforeIdentities],
      afterIdentities: [...afterIdentities],
      sameObjectReference: false,
      sameArrayReference: false,
      scanTimestamp: Date.now(),
      decision: 'PASS',
      reason: null,
      runtimeMarker: R54315_RUNTIME_MARKER,
    })

    // Determine operation kind based on authoritative delta
    let operationKind: FormulaOperationKind
    let eventHint = 'NOOP'

    // Check INSERT_SLOT
    if (afterIdentityCount === beforeIdentityCount + 1 && addedIdentities.length === 1 && removedIdentities.length === 0) {
      // Verify the new identity is indeed present in after and absent in before
      const newId = addedIdentities[0]
      if (after.slotByStableIdentity.has(newId) && !before.slotByStableIdentity.has(newId)) {
        operationKind = 'INSERT_SLOT'
        eventHint = 'INSERT_SLOT'
      } else {
        // INSERT claimed but authoritative delta doesn't match
        operationKind = 'NOOP'
        eventHint = 'INSERT_SLOT'
      }
    }
    // Check REMOVE_SLOT
    else if (beforeIdentityCount === afterIdentityCount + 1 && removedIdentities.length === 1 && addedIdentities.length === 0) {
      const removedId = removedIdentities[0]
      if (before.slotByStableIdentity.has(removedId) && !after.slotByStableIdentity.has(removedId)) {
        operationKind = 'REMOVE_SLOT'
        eventHint = 'REMOVE_SLOT'
      } else {
        operationKind = 'NOOP'
        eventHint = 'REMOVE_SLOT'
      }
    }
    // Check REORDER_SLOT: identity set same but order changed
    else if (beforeIdentityCount === afterIdentityCount && addedIdentities.length === 0 && removedIdentities.length === 0) {
      // All identities survive — check if document order changed for any
      let orderChanged = false
      let scopeChanged = false
      let sourceChanged = false
      let managedChanged = false
      // R5.4.3.21 P0-H: binding change — canonicalHostToken belongs to the
      // current binding ONLY; a fresh host with unchanged logical identity is
      // STRUCTURAL_HOST_REBIND, never identity churn.
      let bindingChanged = false

      for (const id of finalSurviving) {
        const beforeSlot = before.slotByStableIdentity.get(id)
        const afterSlot = after.slotByStableIdentity.get(id)
        if (beforeSlot && afterSlot) {
          if (beforeSlot.documentOrder !== afterSlot.documentOrder) {
            orderChanged = true
          }
          if (beforeSlot.scopeKey !== afterSlot.scopeKey) {
            scopeChanged = true
          }
          if (beforeSlot.canonicalHost !== afterSlot.canonicalHost
            || beforeSlot.canonicalHostToken !== afterSlot.canonicalHostToken) {
            bindingChanged = true
          }
          if (beforeSlot.authoritativeRawSource !== afterSlot.authoritativeRawSource) {
            // R5.4.3.19: raw string comparison alone is not enough — a real
            // source change must be backed by a source revision/hash delta.
            const revDelta = (afterSlot.authoritativeSourceRevision ?? 0) - (beforeSlot.authoritativeSourceRevision ?? 0)
            const hashChanged = beforeSlot.authoritativeSourceHash !== afterSlot.authoritativeSourceHash
            if (revDelta > 0 || (hashChanged && beforeSlot.authoritativeSourceHash !== null && afterSlot.authoritativeSourceHash !== null)) {
              sourceChanged = true
            }
          }
          if (beforeSlot.managedForNumbering !== afterSlot.managedForNumbering) {
            managedChanged = true
          }
        }
      }

      if (orderChanged && !scopeChanged && !sourceChanged) {
        operationKind = 'REORDER_SLOT'
        eventHint = 'REORDER_SLOT'
      } else if (scopeChanged && !sourceChanged && !managedChanged) {
        operationKind = 'MOVE_SCOPE'
        eventHint = 'MOVE_SCOPE'
      } else if (sourceChanged && !scopeChanged && !managedChanged && !orderChanged) {
        operationKind = 'SOURCE_EDIT'
        eventHint = 'SOURCE_EDIT'
      } else if (managedChanged && !sourceChanged && !scopeChanged && !orderChanged) {
        operationKind = 'MANAGED_ELIGIBILITY_CHANGE'
        eventHint = 'MANAGED_ELIGIBILITY_CHANGE'
      } else if (bindingChanged && !orderChanged && !scopeChanged && !sourceChanged && !managedChanged
        && before.headingStateRevision === after.headingStateRevision) {
        // R5.4.3.21 P0-H: semantic NOOP + structural binding change → commit
        // the fresh binding (never discarded), identity stays untouched.
        operationKind = 'STRUCTURAL_HOST_REBIND'
        eventHint = 'STRUCTURAL_HOST_REBIND'
      } else if (before.headingStateRevision !== after.headingStateRevision) {
        // Heading structure changed but no slot-level identity/order/scope/source change
        operationKind = 'HEADING_STRUCTURE_CHANGE'
        eventHint = 'HEADING_STRUCTURE_CHANGE'
      } else {
        // Multiple changes or no discernible change
        operationKind = 'NOOP'
        eventHint = 'NOOP'
      }
    }
    // Check DOCUMENT_SWITCH
    else if (before.documentKey !== after.documentKey) {
      operationKind = 'DOCUMENT_SWITCH'
      eventHint = 'DOCUMENT_SWITCH'
    }
    // Check EDITOR_ROOT_REBIND
    else if (before.editorRootToken !== after.editorRootToken) {
      operationKind = 'EDITOR_ROOT_REBIND'
      eventHint = 'EDITOR_ROOT_REBIND'
    }
    // Check HEADING_STRUCTURE_CHANGE (detected via headingStateRevision)
    else if (before.headingStateRevision !== after.headingStateRevision) {
      operationKind = 'HEADING_STRUCTURE_CHANGE'
      eventHint = 'HEADING_STRUCTURE_CHANGE'
    }
    else {
      operationKind = 'NOOP'
      eventHint = 'NOOP'
    }

    // ── HARD GATE VALIDATIONS ──────────────────────────────────────────

    if (operationKind === 'INSERT_SLOT') {
      // INSERT_SLOT hard gate: afterIdentityCount == beforeIdentityCount + 1, addedIdentities.length == 1
      if (afterIdentityCount !== beforeIdentityCount + 1 || addedIdentities.length !== 1) {
        operationKind = 'NOOP'
        emitRuntimeAudit('FORMULA-OPERATION-CLASSIFICATION-AUTHORITY', {
          operationId: null,
          eventHint,
          beforeStateRevision: before.stateRevision,
          afterCandidateRevision: after.stateRevision,
          beforeStableIdentities: [...beforeIdentities],
          afterStableIdentities: [...afterIdentities],
          addedStableIdentities: addedIdentities,
          removedStableIdentities: removedIdentities,
          survivingStableIdentities: finalSurviving,
          resolvedOperationKind: 'NOOP',
          decision: 'FAIL',
          reason: 'INSERT_WITHOUT_AUTHORITATIVE_IDENTITY_DELTA',
          runtimeMarker: R54315_RUNTIME_MARKER,
        })
        return {
          operationKind: 'NOOP',
          addedIdentities: [],
          removedIdentities: [],
          survivingIdentities: finalSurviving,
        }
      }
    }

    if (operationKind === 'REMOVE_SLOT') {
      // REMOVE_SLOT hard gate: beforeIdentityCount == afterIdentityCount + 1, removedIdentities.length == 1
      if (beforeIdentityCount !== afterIdentityCount + 1 || removedIdentities.length !== 1) {
        operationKind = 'NOOP'
        emitRuntimeAudit('FORMULA-OPERATION-CLASSIFICATION-AUTHORITY', {
          operationId: null,
          eventHint,
          beforeStateRevision: before.stateRevision,
          afterCandidateRevision: after.stateRevision,
          beforeStableIdentities: [...beforeIdentities],
          afterStableIdentities: [...afterIdentities],
          addedStableIdentities: addedIdentities,
          removedStableIdentities: removedIdentities,
          survivingStableIdentities: finalSurviving,
          resolvedOperationKind: 'NOOP',
          decision: 'FAIL',
          reason: 'REMOVE_WITHOUT_AUTHORITATIVE_IDENTITY_DELTA',
          runtimeMarker: R54315_RUNTIME_MARKER,
        })
        return {
          operationKind: 'NOOP',
          addedIdentities: [],
          removedIdentities: [],
          survivingIdentities: finalSurviving,
        }
      }
    }

    if (operationKind === 'REORDER_SLOT') {
      // REORDER_SLOT hard gate: identity set before == identity set after
      if (addedIdentities.length > 0 || removedIdentities.length > 0) {
        operationKind = 'NOOP'
        emitRuntimeAudit('FORMULA-OPERATION-CLASSIFICATION-AUTHORITY', {
          operationId: null,
          eventHint,
          beforeStateRevision: before.stateRevision,
          afterCandidateRevision: after.stateRevision,
          beforeStableIdentities: [...beforeIdentities],
          afterStableIdentities: [...afterIdentities],
          addedStableIdentities: addedIdentities,
          removedStableIdentities: removedIdentities,
          survivingStableIdentities: finalSurviving,
          resolvedOperationKind: 'NOOP',
          decision: 'FAIL',
          reason: 'REORDER_WITH_IDENTITY_SET_CHANGE',
          runtimeMarker: R54315_RUNTIME_MARKER,
        })
        return {
          operationKind: 'NOOP',
          addedIdentities: [],
          removedIdentities: [],
          survivingIdentities: finalSurviving,
        }
      }
    }

    if (operationKind === 'SOURCE_EDIT') {
      // SOURCE_EDIT hard gate: identity/order/scope unchanged
      let identityOrderScopeChanged = false
      for (const id of finalSurviving) {
        const beforeSlot = before.slotByStableIdentity.get(id)
        const afterSlot = after.slotByStableIdentity.get(id)
        if (beforeSlot && afterSlot) {
          if (
            beforeSlot.documentOrder !== afterSlot.documentOrder ||
            beforeSlot.scopeKey !== afterSlot.scopeKey
          ) {
            identityOrderScopeChanged = true
            break
          }
        }
      }
      if (identityOrderScopeChanged) {
        operationKind = 'NOOP'
        emitRuntimeAudit('FORMULA-OPERATION-CLASSIFICATION-AUTHORITY', {
          operationId: null,
          eventHint,
          beforeStateRevision: before.stateRevision,
          afterCandidateRevision: after.stateRevision,
          beforeStableIdentities: [...beforeIdentities],
          afterStableIdentities: [...afterIdentities],
          addedStableIdentities: addedIdentities,
          removedStableIdentities: removedIdentities,
          survivingStableIdentities: finalSurviving,
          resolvedOperationKind: 'NOOP',
          decision: 'FAIL',
          reason: 'SOURCE_EDIT_WITH_IDENTITY_ORDER_SCOPE_CHANGE',
          runtimeMarker: R54315_RUNTIME_MARKER,
        })
        return {
          operationKind: 'NOOP',
          addedIdentities: [],
          removedIdentities: [],
          survivingIdentities: finalSurviving,
        }
      }
    }

    // Emit classification authority marker
    const orderChangedCount = this._countOrderChanges(before, after, finalSurviving)
    const scopeChangedCount = this._countScopeChanges(before, after, finalSurviving)
    const sourceChangedCount = this._countSourceChanges(before, after, finalSurviving)
    const managedChangedCount = this._countManagedChanges(before, after, finalSurviving)
    const bindingChangedCount = this._countBindingChanges(before, after, finalSurviving)

    emitRuntimeAudit('FORMULA-OPERATION-CLASSIFICATION-AUTHORITY', {
      operationId: null,
      eventHint,
      beforeStateRevision: before.stateRevision,
      afterCandidateRevision: after.stateRevision,
      beforeStableIdentities: [...beforeIdentities],
      afterStableIdentities: [...afterIdentities],
      addedStableIdentities: addedIdentities,
      removedStableIdentities: removedIdentities,
      survivingStableIdentities: finalSurviving,
      orderChangedCount,
      scopeChangedCount,
      sourceChangedCount,
      managedChangedCount,
      bindingChangedCount,
      headingStructureChanged: before.headingStateRevision !== after.headingStateRevision,
      resolvedOperationKind: operationKind,
      decision: 'PASS',
      reason: null,
      runtimeMarker: R54315_RUNTIME_MARKER,
    })

    return {
      operationKind,
      addedIdentities,
      removedIdentities,
      survivingIdentities: finalSurviving,
    }
  }

  // ── computeDependencyFrontier ─────────────────────────────────────────

  /**
   * Compute the dependency frontier from a classified operation.
   * This function ONLY works from classified operation data — it must NOT
   * be called directly from event hints.
   */
  computeDependencyFrontier(
    operationKind: FormulaOperationKind,
    addedIdentities: Array<string | number>,
    removedIdentities: Array<string | number>,
    survivingIdentities: Array<string | number>,
    before: CommittedFormulaDocumentState,
    after: CommittedFormulaDocumentState,
  ): FormulaDependencyFrontier | null {
    if (operationKind === 'NOOP') {
      return null
    }
    // R5.4.3.21 P0-H: STRUCTURAL_HOST_REBIND is a binding-only commit — the
    // logical identity/source/numbering are untouched, so NO semantic cascade.
    if (operationKind === 'STRUCTURAL_HOST_REBIND') {
      emitRuntimeAudit('FORMULA-DEPENDENCY-FRONTIER-FROM-CLASSIFIED-OPERATION', {
        frontierId: null,
        operationKind,
        startDocumentOrder: 0,
        endDocumentOrder: 0,
        oldScopeKeys: [],
        newScopeKeys: [],
        affectedStableIdentities: [],
        affectedCount: 0,
        decision: 'REPROJECT',
        reason: 'STRUCTURAL_HOST_REBIND_HAS_NO_SEMANTIC_FRONTIER',
        runtimeMarker: R54315_RUNTIME_MARKER,
      })
      return null
    }

    const frontierId = nextFrontierId()
    let startDocumentOrder = 0
    let endDocumentOrder = 0
    const oldScopeKeys: string[] = []
    const newScopeKeys: string[] = []
    const affectedStableIdentities: Array<string | number> = []

    // Collect all affected identities
    const affectedSet = new Set<string | number>()
    for (const id of addedIdentities) affectedSet.add(id)
    for (const id of removedIdentities) affectedSet.add(id)
    for (const id of survivingIdentities) affectedSet.add(id)

    // Determine start and end document order based on operation kind
    switch (operationKind) {
      case 'INSERT_SLOT': {
        // New slot position → current scope end for the new slot + subsequent surviving formulas
        if (addedIdentities.length > 0) {
          const newId = addedIdentities[0]
          const newSlot = after.slotByStableIdentity.get(newId)
          if (newSlot) {
            startDocumentOrder = newSlot.documentOrder
            // Find the end of the scope for the new slot
            endDocumentOrder = this._findScopeEnd(after, newSlot.scopeKey, newSlot.documentOrder)
          }
        }
        // Add surviving identities that are after the insert point
        for (const id of survivingIdentities) {
          const slot = after.slotByStableIdentity.get(id)
          if (slot && slot.documentOrder >= startDocumentOrder) {
            affectedSet.add(id)
          }
        }
        break
      }
      case 'REMOVE_SLOT': {
        // Old removed position → scope end
        if (removedIdentities.length > 0) {
          const removedId = removedIdentities[0]
          const removedSlot = before.slotByStableIdentity.get(removedId)
          if (removedSlot) {
            startDocumentOrder = removedSlot.documentOrder
            // Find the end of the scope for the removed slot
            endDocumentOrder = this._findScopeEnd(before, removedSlot.scopeKey, removedSlot.documentOrder)
          }
        }
        break
      }
      case 'REORDER_SLOT': {
        // min(oldPosition, newPosition) → scope end
        let minOrder = Number.MAX_SAFE_INTEGER
        for (const id of survivingIdentities) {
          const beforeSlot = before.slotByStableIdentity.get(id)
          const afterSlot = after.slotByStableIdentity.get(id)
          if (beforeSlot && afterSlot && beforeSlot.documentOrder !== afterSlot.documentOrder) {
            minOrder = Math.min(minOrder, beforeSlot.documentOrder, afterSlot.documentOrder)
            // Collect scope keys from affected slots
            if (!oldScopeKeys.includes(beforeSlot.scopeKey)) oldScopeKeys.push(beforeSlot.scopeKey)
            if (!newScopeKeys.includes(afterSlot.scopeKey)) newScopeKeys.push(afterSlot.scopeKey)
          }
        }
        if (minOrder === Number.MAX_SAFE_INTEGER) {
          startDocumentOrder = 0
          endDocumentOrder = after.slotsInDocumentOrder.length > 0
            ? after.slotsInDocumentOrder[after.slotsInDocumentOrder.length - 1].documentOrder
            : 0
        } else {
          startDocumentOrder = minOrder
          // Find scope end for the affected scope
          const scopeKey = newScopeKeys.length > 0 ? newScopeKeys[0] : (oldScopeKeys.length > 0 ? oldScopeKeys[0] : null)
          if (scopeKey) {
            endDocumentOrder = this._findScopeEnd(after, scopeKey, startDocumentOrder)
          } else {
            endDocumentOrder = after.slotsInDocumentOrder.length > 0
              ? after.slotsInDocumentOrder[after.slotsInDocumentOrder.length - 1].documentOrder
              : 0
          }
        }
        break
      }
      case 'MOVE_SCOPE': {
        // old scope suffix UNION new scope suffix
        let minOrder = Number.MAX_SAFE_INTEGER
        let maxOrder = 0
        for (const id of survivingIdentities) {
          const beforeSlot = before.slotByStableIdentity.get(id)
          const afterSlot = after.slotByStableIdentity.get(id)
          if (beforeSlot && afterSlot && beforeSlot.scopeKey !== afterSlot.scopeKey) {
            minOrder = Math.min(minOrder, beforeSlot.documentOrder, afterSlot.documentOrder)
            maxOrder = Math.max(maxOrder, beforeSlot.documentOrder, afterSlot.documentOrder)
            if (!oldScopeKeys.includes(beforeSlot.scopeKey)) oldScopeKeys.push(beforeSlot.scopeKey)
            if (!newScopeKeys.includes(afterSlot.scopeKey)) newScopeKeys.push(afterSlot.scopeKey)
          }
        }
        if (minOrder === Number.MAX_SAFE_INTEGER) {
          startDocumentOrder = 0
          endDocumentOrder = after.slotsInDocumentOrder.length > 0
            ? after.slotsInDocumentOrder[after.slotsInDocumentOrder.length - 1].documentOrder
            : 0
        } else {
          startDocumentOrder = minOrder
          // Union of old and new scope ends
          const oldEnd = this._findScopeEnd(before, oldScopeKeys.length > 0 ? oldScopeKeys[0] : null, startDocumentOrder)
          const newEnd = this._findScopeEnd(after, newScopeKeys.length > 0 ? newScopeKeys[0] : null, startDocumentOrder)
          endDocumentOrder = Math.max(oldEnd, newEnd)
        }
        break
      }
      case 'HEADING_STRUCTURE_CHANGE': {
        // Heading cascade: changed position → document end (or enclosing heading end)
        startDocumentOrder = 0
        endDocumentOrder = after.slotsInDocumentOrder.length > 0
          ? after.slotsInDocumentOrder[after.slotsInDocumentOrder.length - 1].documentOrder
          : 0
        break
      }
      case 'HEADING_TEXT_ONLY': {
        // No dependency frontier for heading text-only changes
        return null
      }
      case 'MANAGED_ELIGIBILITY_CHANGE': {
        // Find the scope of the changed slots
        let minOrder = Number.MAX_SAFE_INTEGER
        let scopeKey: string | null = null
        for (const id of survivingIdentities) {
          const beforeSlot = before.slotByStableIdentity.get(id)
          const afterSlot = after.slotByStableIdentity.get(id)
          if (beforeSlot && afterSlot && beforeSlot.managedForNumbering !== afterSlot.managedForNumbering) {
            minOrder = Math.min(minOrder, beforeSlot.documentOrder, afterSlot.documentOrder)
            scopeKey = afterSlot.scopeKey
          }
        }
        if (minOrder === Number.MAX_SAFE_INTEGER) {
          startDocumentOrder = 0
          endDocumentOrder = after.slotsInDocumentOrder.length > 0
            ? after.slotsInDocumentOrder[after.slotsInDocumentOrder.length - 1].documentOrder
            : 0
        } else {
          startDocumentOrder = minOrder
          endDocumentOrder = scopeKey
            ? this._findScopeEnd(after, scopeKey, startDocumentOrder)
            : (after.slotsInDocumentOrder.length > 0
              ? after.slotsInDocumentOrder[after.slotsInDocumentOrder.length - 1].documentOrder
              : 0)
        }
        break
      }
      case 'NUMBERING_SETTINGS_CHANGE': {
        // Whole managed formula set
        startDocumentOrder = 0
        endDocumentOrder = after.slotsInDocumentOrder.length > 0
          ? after.slotsInDocumentOrder[after.slotsInDocumentOrder.length - 1].documentOrder
          : 0
        break
      }
      case 'SOURCE_EDIT': {
        // Source edit only affects the current formula — no suffix
        return null
      }
      case 'DOCUMENT_SWITCH':
      case 'EDITOR_ROOT_REBIND': {
        // Full document invalidation
        startDocumentOrder = 0
        endDocumentOrder = after.slotsInDocumentOrder.length > 0
          ? after.slotsInDocumentOrder[after.slotsInDocumentOrder.length - 1].documentOrder
          : 0
        break
      }
      default: {
        return null
      }
    }

    // Build affected identities list
    const allAffected = [...affectedSet]
    // Add all surviving identities within the frontier range
    for (const id of survivingIdentities) {
      const slot = after.slotByStableIdentity.get(id) ?? before.slotByStableIdentity.get(id)
      if (slot && slot.documentOrder >= startDocumentOrder && slot.documentOrder <= endDocumentOrder) {
        if (!allAffected.includes(id)) {
          allAffected.push(id)
        }
      }
    }

    const frontier: FormulaDependencyFrontier = {
      frontierId,
      operationKind,
      startDocumentOrder,
      endDocumentOrder,
      oldScopeKeys,
      newScopeKeys,
      affectedStableIdentities: allAffected,
    }

    // Emit dependency frontier marker
    emitRuntimeAudit('FORMULA-DEPENDENCY-FRONTIER-FROM-CLASSIFIED-OPERATION', {
      frontierId,
      operationKind,
      startDocumentOrder,
      endDocumentOrder,
      oldScopeKeys,
      newScopeKeys,
      affectedStableIdentities: allAffected.map((id) => id),
      affectedCount: allAffected.length,
      decision: 'REPROJECT',
      reason: `dependency-frontier-from-${operationKind.toLowerCase()}`,
      runtimeMarker: R54315_RUNTIME_MARKER,
    })

    return frontier
  }

  // ── commitOperation ──────────────────────────────────────────────────

  /**
   * Commit an operation transaction.
   *
   * Phase 1 (Semantic Commit):
   *   - Validates invariants.
   *   - Creates new committed state with revision N+1.
   *   - Marks transaction as SEMANTIC_COMMITTED.
   *
   * Phase 2 (Visible Commit) is handled externally via
   * createProjectionTransactions + dispatch + fulfillment + verification.
   *
   * @returns The new committed state and revision.
   */
  commitOperation(transaction: FormulaOperationTransaction): {
    newState: CommittedFormulaDocumentState
    newRevision: number
  } {
    // ── Hard Gates ────────────────────────────────────────────────────

    // beforeStateObject !== afterCandidateObject
    if (transaction.beforeState === transaction.afterCandidate) {
      emitRuntimeAudit('FORMULA-STATE-SEMANTIC-COMMIT', {
        operationId: transaction.operationId,
        beforeRevision: transaction.beforeStateRevision,
        targetRevision: transaction.targetStateRevision,
        operationKind: transaction.operationKind,
        decision: 'FAIL',
        reason: 'BEFORE_AND_AFTER_CANDIDATE_ARE_SAME_OBJECT',
        runtimeMarker: R54315_RUNTIME_MARKER,
      })
      transaction.status = 'FAILED'
      return { newState: transaction.beforeState, newRevision: this._currentRevision }
    }

    // beforeStateRevision < targetStateRevision
    if (transaction.beforeStateRevision >= transaction.targetStateRevision) {
      emitRuntimeAudit('FORMULA-STATE-SEMANTIC-COMMIT', {
        operationId: transaction.operationId,
        beforeRevision: transaction.beforeStateRevision,
        targetRevision: transaction.targetStateRevision,
        operationKind: transaction.operationKind,
        decision: 'FAIL',
        reason: 'BEFORE_REVISION_NOT_LESS_THAN_TARGET_REVISION',
        runtimeMarker: R54315_RUNTIME_MARKER,
      })
      transaction.status = 'FAILED'
      return { newState: transaction.beforeState, newRevision: this._currentRevision }
    }

    // Semantic commit revision hard gate: targetStateRevision = beforeRevision + 1
    if (transaction.operationKind !== 'NOOP') {
      if (transaction.targetStateRevision !== transaction.beforeStateRevision + 1) {
        emitRuntimeAudit('FORMULA-STATE-SEMANTIC-COMMIT', {
          operationId: transaction.operationId,
          beforeRevision: transaction.beforeStateRevision,
          targetRevision: transaction.targetStateRevision,
          operationKind: transaction.operationKind,
          decision: 'FAIL',
          reason: 'SEMANTIC_COMMIT_REVISION_GATE: target !== before + 1',
          runtimeMarker: R54315_RUNTIME_MARKER,
        })
        transaction.status = 'FAILED'
        return { newState: transaction.beforeState, newRevision: this._currentRevision }
      }
    }

    // INSERT_SLOT hard gate: afterIdentityCount == beforeIdentityCount + 1, addedIdentities.length == 1
    if (transaction.operationKind === 'INSERT_SLOT') {
      const beforeCount = transaction.beforeState.slotsInDocumentOrder.length
      const afterCount = transaction.afterCandidate.slotsInDocumentOrder.length
      if (afterCount !== beforeCount + 1 || transaction.addedStableIdentities.length !== 1) {
        emitRuntimeAudit('FORMULA-STATE-SEMANTIC-COMMIT', {
          operationId: transaction.operationId,
          beforeRevision: transaction.beforeStateRevision,
          targetRevision: transaction.targetStateRevision,
          beforeIdentityCount: beforeCount,
          afterIdentityCount: afterCount,
          addedStableIdentities: transaction.addedStableIdentities,
          operationKind: transaction.operationKind,
          decision: 'FAIL',
          reason: 'INSERT_WITHOUT_AUTHORITATIVE_IDENTITY_DELTA',
          runtimeMarker: R54315_RUNTIME_MARKER,
        })
        transaction.status = 'FAILED'
        return { newState: transaction.beforeState, newRevision: this._currentRevision }
      }
    }

    // REMOVE_SLOT hard gate: beforeIdentityCount == afterIdentityCount + 1, removedIdentities.length == 1
    if (transaction.operationKind === 'REMOVE_SLOT') {
      const beforeCount = transaction.beforeState.slotsInDocumentOrder.length
      const afterCount = transaction.afterCandidate.slotsInDocumentOrder.length
      if (beforeCount !== afterCount + 1 || transaction.removedStableIdentities.length !== 1) {
        emitRuntimeAudit('FORMULA-STATE-SEMANTIC-COMMIT', {
          operationId: transaction.operationId,
          beforeRevision: transaction.beforeStateRevision,
          targetRevision: transaction.targetStateRevision,
          beforeIdentityCount: beforeCount,
          afterIdentityCount: afterCount,
          removedStableIdentities: transaction.removedStableIdentities,
          operationKind: transaction.operationKind,
          decision: 'FAIL',
          reason: 'REMOVE_WITHOUT_AUTHORITATIVE_IDENTITY_DELTA',
          runtimeMarker: R54315_RUNTIME_MARKER,
        })
        transaction.status = 'FAILED'
        return { newState: transaction.beforeState, newRevision: this._currentRevision }
      }
    }

    // ── Build new committed state from afterCandidate ─────────────────

    const newRevision = transaction.targetStateRevision
    const newState: CommittedFormulaDocumentState = {
      stateRevision: newRevision,
      documentKey: transaction.afterCandidate.documentKey,
      documentGeneration: transaction.afterCandidate.documentGeneration,
      editorRootToken: transaction.afterCandidate.editorRootToken,
      headingStateRevision: transaction.afterCandidate.headingStateRevision,
      slotsInDocumentOrder: transaction.afterCandidate.slotsInDocumentOrder,
      slotByStableIdentity: new Map(transaction.afterCandidate.slotByStableIdentity),
      semanticSignature: transaction.afterCandidate.semanticSignature,
      committedAtOperationId: transaction.operationId,
      ...buildStateReadiness(
        transaction.afterCandidate.slotsInDocumentOrder,
        transaction.afterCandidate.headingRevisionUsed,
        transaction.afterCandidate.numberingPlanRevisionUsed,
      ),
    }

    // ── Update store state ───────────────────────────────────────────

    this._currentRevision = newRevision
    this._committedState = newState
    this._documentStates.set(newRevision, newState)

    // Store the transaction
    this._pendingTransactions.set(transaction.operationId, transaction)
    transaction.status = 'SEMANTIC_COMMITTED'

    // Update document metadata
    this._documentKey = newState.documentKey
    this._documentGeneration = newState.documentGeneration
    this._editorRootToken = newState.editorRootToken
    this._headingStateRevision = newState.headingStateRevision

    // ── Emit semantic commit marker ──────────────────────────────────

    emitRuntimeAudit('FORMULA-STATE-SEMANTIC-COMMIT', {
      operationId: transaction.operationId,
      beforeRevision: transaction.beforeStateRevision,
      targetRevision: newRevision,
      operationKind: transaction.operationKind,
      slotCount: newState.slotsInDocumentOrder.length,
      semanticSignature: newState.semanticSignature,
      addedIdentities: transaction.addedStableIdentities,
      removedIdentities: transaction.removedStableIdentities,
      survivingCount: transaction.survivingStableIdentities.length,
      decision: 'PASS',
      reason: null,
      runtimeMarker: R54315_RUNTIME_MARKER,
    })

    return { newState, newRevision }
  }

  // ── createRenderTransaction ──────────────────────────────────────────

  /**
   * Create a FormulaRenderTransaction from a committed slot.
   * This is a DERIVED VIEW — it reads from the committed state, never
   * creates or modifies identity.
   *
   * Returns null if the stable identity is not found in the committed state.
   */
  createRenderTransaction(stableIdentity: string | number): FormulaRenderTransaction | null {
    if (!this._committedState) return null

    const slot = this._committedState.slotByStableIdentity.get(stableIdentity)
    if (!slot) return null

    // R5.4.3.18: RENDER AUTHORITY READY barrier — never create an authorized
    // transaction with a provisional/absent desiredTag.
    if (!this._committedState.renderAuthorityReady || slot.desiredTag === null || slot.desiredTag === '') {
      emitRuntimeAudit('FORMULA-NUMBERING-READINESS-AUTHORITY', {
        documentKey: this._documentKey,
        generation: this._documentGeneration,
        rootToken: this._editorRootToken,
        stateRevision: this._currentRevision,
        structuralReady: this._committedState.structuralReady,
        managedSlotCount: this._committedState.managedSlotCount,
        desiredTagReadyCount: this._committedState.desiredTagReadyCount,
        headingRevisionUsed: this._committedState.headingRevisionUsed,
        numberingPlanRevisionUsed: this._committedState.numberingPlanRevisionUsed,
        allManagedDesiredTagsReady: this._committedState.allManagedDesiredTagsReady,
        renderAuthorityReady: false,
        decision: 'FAIL',
        reason: 'RENDER_AUTHORITY_NOT_READY',
        runtimeMarker: R54315_RUNTIME_MARKER,
      })
      return null
    }

    const formulaIndex = this._committedState.slotsInDocumentOrder.indexOf(slot)
    if (formulaIndex < 0) return null

    const renderTransactionId = `render-${this._currentRevision}-${stableIdentity}-${Date.now()}`

    const tx: FormulaRenderTransaction = {
      renderTransactionId,
      stateRevision: this._currentRevision,
      stableIdentity: slot.stableIdentity,
      canonicalHost: slot.canonicalHost,
      canonicalHostToken: slot.canonicalHostToken,
      formulaIndex,
      sourceState: slot.sourceState,
      rawSource: slot.authoritativeRawSource ?? '',
      desiredTag: slot.desiredTag ?? '',
      operationId: this._committedState.committedAtOperationId,
    }

    return tx
  }

  // ── R5.4.3.18: Numbering Baseline Hydration ──────────────────────────

  /**
   * Actively hydrate the committed structural state with the authoritative
   * numbering plan (chapter/section/sequence/scope/desiredTag). Commits a
   * NUMBERING_BASELINE revision and, when all managed slots have a desiredTag
   * and both heading/numbering plan revisions are present, promotes
   * renderAuthorityReady=true. Emits FORMULA-NUMBERING-BASELINE-HYDRATION +
   * FORMULA-RENDER-AUTHORITY-PROMOTION.
   */
  hydrateNumberingAuthorityIntoState(input: {
    planEntries: Array<{
      canonicalHost: HTMLElement
      stableIdentity: string | number
      chapterOrdinal: number | null
      sectionOrdinal: number | null
      subsectionOrdinal: number | null
      sequenceValue: number
      scopeKey: string
      desiredTag: string
      managedForNumbering: boolean
    }>
    headingRevision: number
    numberingPlanRevision: number
  }): CommittedFormulaDocumentState | null {
    if (!this._committedState) return null
    const before = this._committedState

    const byHost = new Map<HTMLElement, typeof input.planEntries[number]>()
    const byIdentity = new Map<string | number, typeof input.planEntries[number]>()
    for (const e of input.planEntries) {
      byHost.set(e.canonicalHost, e)
      byIdentity.set(e.stableIdentity, e)
    }

    let matchedSlotCount = 0
    let unmatchedSlotCount = 0
    const previousDesiredTags = before.slotsInDocumentOrder.map((s) => s.desiredTag)
    const hydratedSlots: CanonicalFormulaSlot[] = before.slotsInDocumentOrder.map((slot) => {
      const entry = byHost.get(slot.canonicalHost) ?? byIdentity.get(slot.stableIdentity)
      if (!entry) {
        unmatchedSlotCount++
        return slot
      }
      matchedSlotCount++
      return {
        ...slot,
        scopeKey: entry.scopeKey,
        chapterOrdinal: entry.chapterOrdinal,
        sectionOrdinal: entry.sectionOrdinal,
        subsectionOrdinal: entry.subsectionOrdinal,
        sequenceValue: entry.sequenceValue,
        managedForNumbering: entry.managedForNumbering,
        desiredTag: entry.desiredTag,
        numberingAuthority: {
          structuralReady: true,
          headingContextReady: true,
          numberingPlanReady: true,
          desiredTagReady: true,
          headingRevisionUsed: input.headingRevision,
          numberingPlanRevisionUsed: input.numberingPlanRevision,
          desiredTag: entry.desiredTag,
          renderAuthorityReady: true,
          authoritySource: 'COMMITTED_NUMBERING_STATE',
        },
      }
    })

    const nextDesiredTags = hydratedSlots.map((s) => s.desiredTag)
    const nextRevision = before.stateRevision + 1
    const readiness = buildStateReadiness(hydratedSlots, input.headingRevision, input.numberingPlanRevision)
    const nextState: CommittedFormulaDocumentState = {
      stateRevision: nextRevision,
      documentKey: before.documentKey,
      documentGeneration: before.documentGeneration,
      editorRootToken: before.editorRootToken,
      headingStateRevision: before.headingStateRevision,
      slotsInDocumentOrder: hydratedSlots,
      slotByStableIdentity: new Map(hydratedSlots.map((s) => [s.stableIdentity, s])),
      semanticSignature: computeSemanticSignature(hydratedSlots),
      committedAtOperationId: before.committedAtOperationId,
      ...readiness,
    }

    this._currentRevision = nextRevision
    this._committedState = nextState
    this._documentStates.set(nextRevision, nextState)

    emitRuntimeAudit('FORMULA-NUMBERING-BASELINE-HYDRATION', {
      documentKey: nextState.documentKey,
      generation: nextState.documentGeneration,
      rootToken: nextState.editorRootToken,
      previousStateRevision: before.stateRevision,
      nextStateRevision: nextRevision,
      slotCount: hydratedSlots.length,
      matchedSlotCount,
      unmatchedSlotCount,
      previousDesiredTags,
      nextDesiredTags,
      headingRevisionUsed: input.headingRevision,
      numberingPlanRevisionUsed: input.numberingPlanRevision,
      renderAuthorityReadyBefore: before.renderAuthorityReady,
      renderAuthorityReadyAfter: readiness.renderAuthorityReady,
      decision: readiness.renderAuthorityReady ? 'PASS' : 'PARTIAL',
      reason: readiness.renderAuthorityReady ? null : 'NOT_ALL_MANAGED_DESIRED_TAGS_READY',
      runtimeMarker: R54315_RUNTIME_MARKER,
    })

    emitRuntimeAudit('FORMULA-RENDER-AUTHORITY-PROMOTION', {
      stateRevision: nextRevision,
      structuralReady: readiness.structuralReady,
      numberingReady: readiness.allManagedDesiredTagsReady,
      previousRenderAuthorityReady: before.renderAuthorityReady,
      nextRenderAuthorityReady: readiness.renderAuthorityReady,
      previousDesiredTags,
      nextDesiredTags,
      promotionTrigger: 'NUMBERING_PLAN_READY',
      decision: readiness.renderAuthorityReady ? 'PASS' : 'FAIL',
      reason: readiness.renderAuthorityReady ? null : 'RENDER_AUTHORITY_NOT_READY',
      runtimeMarker: R54315_RUNTIME_MARKER,
    })

    emitRuntimeAudit('FORMULA-NUMBERING-READINESS-AUTHORITY', {
      documentKey: nextState.documentKey,
      generation: nextState.documentGeneration,
      rootToken: nextState.editorRootToken,
      stateRevision: nextRevision,
      structuralReady: readiness.structuralReady,
      managedSlotCount: readiness.managedSlotCount,
      desiredTagReadyCount: readiness.desiredTagReadyCount,
      headingRevisionUsed: input.headingRevision,
      numberingPlanRevisionUsed: input.numberingPlanRevision,
      allManagedDesiredTagsReady: readiness.allManagedDesiredTagsReady,
      renderAuthorityReady: readiness.renderAuthorityReady,
      decision: readiness.renderAuthorityReady ? 'PASS' : 'PARTIAL',
      reason: readiness.renderAuthorityReady ? null : 'NUMBERING_NOT_READY',
      runtimeMarker: R54315_RUNTIME_MARKER,
    })

    return nextState
  }

  // ── createProjectionTransactions ─────────────────────────────────────

  /**
   * Create projection transactions for all affected identities in a committed operation.
   * Each projection transaction carries persistent identity through the async pipeline.
   */
  createProjectionTransactions(
    transaction: FormulaOperationTransaction,
  ): FormulaProjectionTransaction[] {
    const projections: FormulaProjectionTransaction[] = []

    // R5.4.3.21 P0-H: STRUCTURAL_HOST_REBIND commits the binding ONLY — logical
    // identity/source/desiredTag are untouched, so no projection is created
    // (avoids a projection feedback loop over surviving formulas).
    if (transaction.operationKind === 'STRUCTURAL_HOST_REBIND') {
      return projections
    }

    // Determine which identities need projection
    const identitiesToProject = new Set<string | number>()

    // All affected identities from the transaction
    for (const id of transaction.affectedStableIdentities) {
      identitiesToProject.add(id)
    }

    // Also add identities from the dependency frontier
    if (transaction.dependencyFrontier) {
      for (const id of transaction.dependencyFrontier.affectedStableIdentities) {
        identitiesToProject.add(id)
      }
    }

    for (const stableIdentity of identitiesToProject) {
      const slot = transaction.afterCandidate.slotByStableIdentity.get(stableIdentity)
      if (!slot) continue

      // Only create projections for managed formulas with desiredTag
      if (!slot.managedForNumbering || slot.desiredTag === null) continue

      // R5.4.3.19: source integrity gate — UNKNOWN source blocks the provider.
      if (!slot.sourceAuthorityReady || slot.sourceState === 'UNKNOWN') {
        const blockedTx: FormulaProjectionTransaction = {
          projectionTransactionId: nextProjectionTransactionId(),
          operationId: transaction.operationId,
          targetStateRevision: transaction.targetStateRevision,
          stableIdentity: slot.stableIdentity,
          formulaIndex: transaction.afterCandidate.slotsInDocumentOrder.indexOf(slot),
          canonicalHost: slot.canonicalHost,
          canonicalHostToken: slot.canonicalHostToken,
          desiredTag: slot.desiredTag,
          rawSource: '',
          sourceState: 'UNKNOWN',
          authoritativeSourceHash: null,
          authoritativeSourceRevision: null,
          compositeOwner: null,
          previewHost: null,
          oldNativeMjx: null,
          nativeDomMutationCount: 0,
          status: 'BLOCKED_SOURCE_NOT_READY',
        }
        this._projectionTransactions.set(blockedTx.projectionTransactionId, blockedTx)
        emitRuntimeAudit('FORMULA-PROJECTION-TRANSACTION', {
          projectionTransactionId: blockedTx.projectionTransactionId,
          operationId: blockedTx.operationId,
          targetStateRevision: blockedTx.targetStateRevision,
          stableIdentity: blockedTx.stableIdentity,
          formulaIndex: blockedTx.formulaIndex,
          canonicalHostToken: blockedTx.canonicalHostToken,
          desiredTag: blockedTx.desiredTag,
          status: 'BLOCKED_SOURCE_NOT_READY',
          runtimeMarker: R54315_RUNTIME_MARKER,
        })
        // R5.4.3.21: the blocked projection MUST reach the caller so the
        // pending source-ready registry can replay it when the source becomes
        // ready (never silently swallowed inside the store).
        projections.push(blockedTx)
        continue
      }

      const formulaIndex = transaction.afterCandidate.slotsInDocumentOrder.indexOf(slot)
      if (formulaIndex < 0) continue

      const projectionTransactionId = nextProjectionTransactionId()

      // Find composite owner (the parent figure/block that contains the formula)
      const compositeOwner = (slot.canonicalHost.closest?.(
        'figure.math, .md-block-formula, .md-math-block, .typora-math-block',
      ) as HTMLElement | null) ?? null

      // Find preview host (MJX-CONTAINER within the composite owner)
      const previewHost = compositeOwner
        ? (compositeOwner.querySelector<HTMLElement>('mjx-container, .MathJax_Display, .MJXc-display') as HTMLElement | null)
        : (slot.canonicalHost.querySelector<HTMLElement>('mjx-container, .MathJax_Display, .MJXc-display') as HTMLElement | null)

      // Find old native MJX (the current visible output)
      const oldNativeMjx = previewHost

      const projTx: FormulaProjectionTransaction = {
        projectionTransactionId,
        operationId: transaction.operationId,
        targetStateRevision: transaction.targetStateRevision,
        stableIdentity: slot.stableIdentity,
        formulaIndex,
        canonicalHost: slot.canonicalHost,
        canonicalHostToken: slot.canonicalHostToken,
        desiredTag: slot.desiredTag,
        rawSource: slot.authoritativeRawSource ?? '',
        sourceState: slot.sourceState,
        authoritativeSourceHash: slot.authoritativeSourceHash,
        authoritativeSourceRevision: slot.authoritativeSourceRevision,
        compositeOwner,
        previewHost,
        oldNativeMjx,
        nativeDomMutationCount: 0,
        status: 'CREATED',
      }

      this._projectionTransactions.set(projectionTransactionId, projTx)
      projections.push(projTx)

      // Emit projection transaction marker
      emitRuntimeAudit('FORMULA-PROJECTION-TRANSACTION', {
        projectionTransactionId,
        operationId: transaction.operationId,
        targetStateRevision: transaction.targetStateRevision,
        stableIdentity,
        formulaIndex,
        desiredTag: slot.desiredTag,
        sourceState: slot.sourceState,
        status: 'CREATED',
        runtimeMarker: R54315_RUNTIME_MARKER,
      })
    }

    return projections
  }

  // ── computeOrderedReprojection ───────────────────────────────────────

  /**
   * Recompute sequence values and desiredTags for affected slots.
   * This is called after the dependency frontier is determined, to update
   * the sequence and desiredTag for slots within the affected range.
   *
   * @param after - The after-candidate state (will be modified in-place for the new state).
   * @param affectedIdentities - The identities to reproject.
   * @param headings - The heading info for scope resolution.
   * @returns The updated slots (new array, does not mutate input).
   */
  computeOrderedReprojection(
    after: CommittedFormulaDocumentState,
    affectedIdentities: Array<string | number>,
    headings: HeadingInfo[],
  ): CanonicalFormulaSlot[] {
    // Build a map of affected slots keyed by stableIdentity
    const affectedSet = new Set(affectedIdentities)
    const updatedSlots: CanonicalFormulaSlot[] = []

    for (const slot of after.slotsInDocumentOrder) {
      if (affectedSet.has(slot.stableIdentity)) {
        // Recompute scope and sequence for this slot
        const scopeInfo = resolveScopeKey(
          slot.canonicalHost,
          null as unknown as HTMLElement, // Will be resolved in production
          headings,
          slot.documentOrder,
        )

        // Recompute sequence value: count managed formulas in the same scope
        // up to and including this slot's document order
        let sequenceValue = 0
        if (slot.managedForNumbering) {
          for (const otherSlot of after.slotsInDocumentOrder) {
            if (otherSlot.documentOrder > slot.documentOrder) break
            if (
              otherSlot.managedForNumbering &&
              otherSlot.scopeKey === scopeInfo.scopeKey
            ) {
              sequenceValue++
            }
          }
        }

        // Recompute desiredTag
        let desiredTag: string | null = null
        if (slot.managedForNumbering) {
          desiredTag = this._formatDesiredTag(
            scopeInfo.chapterOrdinal,
            scopeInfo.sectionOrdinal,
            scopeInfo.subsectionOrdinal,
            sequenceValue,
          )
        }

        // Update the slot with new scope and sequence info
        const updatedSlot: CanonicalFormulaSlot = {
          ...slot,
          scopeKey: scopeInfo.scopeKey,
          chapterOrdinal: scopeInfo.chapterOrdinal,
          sectionOrdinal: scopeInfo.sectionOrdinal,
          subsectionOrdinal: scopeInfo.subsectionOrdinal,
          sequenceValue,
          desiredTag,
          renderRevision: slot.renderRevision + 1,
          numberingAuthority: {
            ...slot.numberingAuthority,
            desiredTag,
            desiredTagReady: desiredTag !== null,
            numberingPlanReady: slot.numberingAuthority.numberingPlanReady || desiredTag !== null,
          },
        }
        updatedSlots.push(updatedSlot)
      } else {
        // Unaffected slots pass through unchanged
        updatedSlots.push(slot)
      }
    }

    // Emit ordered reprojection marker
    emitRuntimeAudit('FORMULA-ORDERED-FRONTIER-REPROJECTION', {
      affectedIdentities: affectedIdentities.map((id) => id),
      affectedCount: affectedIdentities.length,
      updatedSlotCount: updatedSlots.length,
      operation: 'ORDERED_REPROJECTION',
      runtimeMarker: R54315_RUNTIME_MARKER,
    })

    return updatedSlots
  }

  // ── Internal Helpers ─────────────────────────────────────────────────

  private _createEmptyState(): CommittedFormulaDocumentState {
    return {
      stateRevision: 0,
      documentKey: this._documentKey,
      documentGeneration: this._documentGeneration,
      editorRootToken: this._editorRootToken,
      headingStateRevision: this._headingStateRevision,
      slotsInDocumentOrder: [],
      slotByStableIdentity: new Map(),
      semanticSignature: 'empty',
      committedAtOperationId: null,
      structuralReady: true,
      managedSlotCount: 0,
      desiredTagReadyCount: 0,
      allManagedDesiredTagsReady: true,
      headingRevisionUsed: null,
      numberingPlanRevisionUsed: null,
      renderAuthorityReady: false,
    }
  }

  private _scanFormulaSlots(
    editorRoot: HTMLElement,
    headings: HeadingInfo[],
    sourceSnapshots?: Map<HTMLElement, FormulaSourceSnapshot>,
  ): CanonicalFormulaSlot[] {
    let rawNodeVisitedCount = 0
    let canonicalCandidateCount = 0
    let nonStringClassNameCount = 0
    let svgLikeNodeCount = 0
    let mathJaxInternalRejectedCount = 0
    let inlineMathRejectedCount = 0
    let disconnectedRejectedCount = 0
    let exceptionCount = 0

    const hosts: HTMLElement[] = []
    try {
      const walker = document.createTreeWalker(
        editorRoot,
        NodeFilter.SHOW_ELEMENT,
        {
          acceptNode: (node: Node) => {
            rawNodeVisitedCount++
            try {
              const el = node as Element
              if (typeof (el as { className?: unknown }).className !== 'string') {
                nonStringClassNameCount++
              }
              if (el.tagName === 'SVG' || el.tagName === 'svg' || el.tagName.startsWith('MJX-')) {
                if (el.tagName.startsWith('MJX-') || el.tagName === 'SVG') {
                  if (el.tagName.startsWith('MJX-')) mathJaxInternalRejectedCount++
                  else svgLikeNodeCount++
                }
                return NodeFilter.FILTER_SKIP
              }
              if (!(el instanceof HTMLElement)) {
                svgLikeNodeCount++
                return NodeFilter.FILTER_SKIP
              }
              if (!el.isConnected) {
                disconnectedRejectedCount++
                return NodeFilter.FILTER_SKIP
              }
              if (el.tagName === 'SPAN' || el.classList.contains('md-math')) {
                inlineMathRejectedCount++
                return NodeFilter.FILTER_SKIP
              }
              if (isFormulaHostElement(el)) {
                canonicalCandidateCount++
                return NodeFilter.FILTER_ACCEPT
              }
              return NodeFilter.FILTER_SKIP
            } catch {
              exceptionCount++
              return NodeFilter.FILTER_SKIP
            }
          },
        },
      )
      let node: Node | null = walker.firstChild()
      while (node) {
        try {
          if (node instanceof HTMLElement) hosts.push(node)
        } catch {
          exceptionCount++
        }
        node = walker.nextNode()
      }
    } catch {
      exceptionCount++
    }

    const slots = this._slotsFromHosts(hosts, headings, undefined, sourceSnapshots)

    emitRuntimeAudit('FORMULA-STATE-REAL-DOM-SCAN-SAFETY', {
      documentKey: this._documentKey,
      generation: this._documentGeneration,
      rootToken: this._editorRootToken,
      rawNodeVisitedCount,
      canonicalCandidateCount,
      canonicalSlotCount: slots.length,
      nonStringClassNameCount,
      svgLikeNodeCount,
      mathJaxInternalRejectedCount,
      inlineMathRejectedCount,
      disconnectedRejectedCount,
      exceptionCount,
      decision: exceptionCount === 0 ? 'PASS' : 'FAIL',
      reason: exceptionCount === 0 ? null : 'SCAN_EXCEPTION_DETECTED',
      runtimeMarker: R54315_RUNTIME_MARKER,
    })

    return slots
  }

  /**
   * Build slots from an already-canonical host list (shared by all scan paths).
   *
   * R5.4.3.21 P0-H/I/J: logical stable identity is DECOUPLED from the
   * ephemeral canonicalHostToken.
   *   1. Exact host reference match → identity/source/numbering carry-forward
   *      with ZERO binding change.
   *   2. Remaining hosts + remaining committed slots with COUNT PARITY →
   *      positional (document-order) alignment rebinds the host WITHOUT
   *      touching stableIdentity/sourceRevision/desiredTag/formulaIndex
   *      (STRUCTURAL_HOST_REBIND, bindingRevision+1). This covers Typora
   *      edit-mode host A→host B replacement.
   *   3. Remaining hosts with count mismatch → genuinely new slots (INSERT
   *      candidates via classifyOperation); identity from the persistent
   *      structural-slot counter, NEVER from host token.
   * NEVER matches by source equality / hash / sentinel / focus / session.
   */
  private _slotsFromHosts(
    hosts: HTMLElement[],
    headings: HeadingInfo[],
    desiredTagOverrides?: Map<HTMLElement, string | null>,
    sourceSnapshots?: Map<HTMLElement, FormulaSourceSnapshot>,
  ): CanonicalFormulaSlot[] {
    const slots: CanonicalFormulaSlot[] = []
    let formulaIndex = 0
    let exceptionCount = 0

    // ── P0-H: logical identity alignment against committed state ──
    const committed = this._committedState ? this._committedState.slotsInDocumentOrder.slice() : []
    const committedByHost = new Map<HTMLElement, CanonicalFormulaSlot>()
    for (const s of committed) committedByHost.set(s.canonicalHost, s)
    const claimedCommitted = new Set<CanonicalFormulaSlot>()
    const claimedByHost = new Map<HTMLElement, { slot: CanonicalFormulaSlot; rebind: boolean }>()
    const unclaimedHosts: HTMLElement[] = []

    // Pass 1: exact host reference match.
    for (const host of hosts) {
      const exact = committedByHost.get(host)
      if (exact) {
        claimedCommitted.add(exact)
        claimedByHost.set(host, { slot: exact, rebind: false })
      } else {
        unclaimedHosts.push(host)
      }
    }

    // Pass 2: positional alignment ONLY when counts are equal (host-replacement
    // rebind, e.g. Typora edit mode). Both lists are in document order.
    let alignedRebindCount = 0
    if (unclaimedHosts.length > 0) {
      const unclaimedCommitted = committed.filter((s) => !claimedCommitted.has(s))
      if (unclaimedHosts.length === unclaimedCommitted.length) {
        for (let i = 0; i < unclaimedHosts.length; i++) {
          claimedByHost.set(unclaimedHosts[i], { slot: unclaimedCommitted[i], rebind: true })
        }
        alignedRebindCount = unclaimedHosts.length
        unclaimedHosts.length = 0
      }
      // count mismatch → remaining unclaimed hosts stay NEW (INSERT candidates)
    }

    for (const host of hosts) {
      try {
        // Hosts arrive in document order (canonical collector / TreeWalker) —
        // the array index IS the document order of the block formula.
        const documentOrder = formulaIndex
        const scopeInfo = resolveScopeKey(host, host.parentElement ?? host, headings, documentOrder)

        const claim = claimedByHost.get(host)
        if (claim) {
          // ── Identity + source + numbering carry-forward (survivor) ──
          const prior = claim.slot
          const hostToken = tokenFor(host)
          const isRebind = claim.rebind || prior.canonicalHost !== host
          if (isRebind) {
            // source-equality is NEVER used for duplicate identity — the
            // rebind below is purely structural (positional/scope alignment).
            emitRuntimeAudit('FORMULA-STRUCTURAL-HOST-REBIND', {
              stableIdentity: prior.stableIdentity,
              formulaIndex: prior.documentOrder,
              oldCanonicalHostToken: prior.canonicalHostToken,
              newCanonicalHostToken: hostToken,
              bindingRevisionBefore: prior.bindingRevision ?? 1,
              bindingRevisionAfter: (prior.bindingRevision ?? 1) + 1,
              sourceRevision: prior.authoritativeSourceRevision,
              desiredTag: prior.desiredTag,
              sourceState: prior.sourceState,
              alignment: claim.rebind ? 'POSITIONAL_COUNT_PARITY' : 'REFERENCE_CHANGED',
              decision: 'REBIND',
              reason: null,
              runtimeMarker: R54315_RUNTIME_MARKER,
            })
          }

          // Recompute sequence within scope (same as the pre-existing scan
          // semantics); identity/source stay authoritative. The scope/ordinals
          // are authoritative from the committed numbering plan — never
          // re-derived from an incomplete heading scan (would falsely flip
          // a STRUCTURAL_HOST_REBIND into MOVE_SCOPE).
          let sequenceValue = 0
          if (prior.managedForNumbering) {
            for (const s of slots) {
              if (s.managedForNumbering && s.scopeKey === prior.scopeKey) sequenceValue++
            }
            sequenceValue++ // 1-based
          }

          // R5.4.3.21 P0-I/J: the trusted numbering override (legacy pipeline)
          // is applied to SURVIVORS as well — an insert/remove suffix must
          // renumber h2 5.3.2 → 5.3.3 in the SAME commit (never kept stale).
          let desiredTag = prior.desiredTag
          let numberingPlanReady = prior.numberingAuthority?.numberingPlanReady ?? false
          const trustedTag = desiredTagOverrides?.get(host) ?? null
          if (trustedTag !== null && trustedTag !== undefined && trustedTag !== '') {
            desiredTag = trustedTag
            numberingPlanReady = true
          }
          const numberingAuthority: FormulaNumberingAuthorityState = desiredTag !== (prior.desiredTag ?? null)
            ? {
                ...prior.numberingAuthority,
                desiredTag,
                desiredTagReady: numberingPlanReady && desiredTag !== null,
                numberingPlanReady,
              }
            : prior.numberingAuthority

          const slot: CanonicalFormulaSlot = {
            ...prior,
            canonicalHost: host,
            canonicalHostToken: hostToken,
            bindingRevision: isRebind ? (prior.bindingRevision ?? 1) + 1 : (prior.bindingRevision ?? 1),
            documentOrder,
            // Scope/ordinals come from the committed numbering plan — preserved
            // verbatim so a pure host rebind never degrades into MOVE_SCOPE.
            scopeKey: prior.scopeKey,
            chapterOrdinal: prior.chapterOrdinal,
            sectionOrdinal: prior.sectionOrdinal,
            subsectionOrdinal: prior.subsectionOrdinal,
            sequenceValue,
            desiredTag,
            numberingAuthority,
            renderRevision: prior.renderRevision + (isRebind ? 1 : 0),
          }
          slots.push(slot)
          formulaIndex++
          continue
        }

        // ── R5.4.3.17: identity ONLY from structural slot + operation lineage,
        // using the BOUND runtime context (never :0:0:n). R5.4.3.21 P0-H: the
        // NEW-slot identity uses the persistent structural counter — it is NOT
        // aliased to the ephemeral host token. ──
        const hostToken = tokenFor(host)
        const stableIdentity = `${this._documentKey}:${this._documentGeneration}:${this._editorRootToken}:structural-${++this._slotIdentityCounter}`

        // R5.4.3.17: stable identity context invariant — identity components MUST
        // match the bound store context; :0:0:n is a hard FAIL.
        this._checkStableIdentityContextInvariant(stableIdentity, this._documentKey, this._documentGeneration, this._editorRootToken, hostToken)

        checkIdentityAuthorityInvariant(
          stableIdentity,
          hostToken,
          'STRUCTURAL_SLOT',
        )

        // Determine managedForNumbering — for now, all canonical block formulas are managed
        const managedForNumbering = true

        // Compute sequence value within scope
        let sequenceValue = 0
        if (managedForNumbering) {
          for (const s of slots) {
            if (s.managedForNumbering && s.scopeKey === scopeInfo.scopeKey) {
              sequenceValue++
            }
          }
          sequenceValue++ // 1-based
        }

        // R5.4.3.18: TWO-PHASE desiredTag.
        //   - Trusted override (authoritative numbering pipeline) → numbering-ready
        //     desiredTag, authoritySource=LEGACY_NUMBERING_PLAN (hydrated later into
        //     COMMITTED_NUMBERING_STATE by hydrateNumberingAuthorityIntoState).
        //   - No override → desiredTag=null, STRUCTURAL_ONLY (renderAuthorityReady=false).
        // NEVER fall back to sequence.toString() as a final desiredTag.
        let desiredTag: string | null = null
        let numberingPlanReady = false
        const trustedTag = desiredTagOverrides?.get(host) ?? null
        if (trustedTag !== null && trustedTag !== undefined && trustedTag !== '') {
          desiredTag = trustedTag
          numberingPlanReady = true
        }

        const numberingAuthority: FormulaNumberingAuthorityState = {
          structuralReady: true,
          headingContextReady: numberingPlanReady,
          numberingPlanReady,
          desiredTagReady: numberingPlanReady && desiredTag !== null,
          headingRevisionUsed: null,
          numberingPlanRevisionUsed: null,
          desiredTag,
          renderAuthorityReady: false,
          authoritySource: numberingPlanReady ? 'LEGACY_NUMBERING_PLAN' : 'STRUCTURAL_ONLY',
        }

        // R5.4.3.19: authoritative source — from explicit snapshot map, else
        // carry-forward from the previous committed state (surviving host),
        // else UNKNOWN. NEVER derive from composite host.textContent.
        const sourceSnapshot = this._resolveSlotSourceSnapshot(host, sourceSnapshots)

        const slot: CanonicalFormulaSlot = {
          stableIdentity,
          canonicalHost: host,
          canonicalHostToken: hostToken,
          bindingRevision: 1,
          documentKey: this._documentKey,
          documentGeneration: this._documentGeneration,
          editorRootToken: this._editorRootToken,
          documentOrder,
          scopeKey: scopeInfo.scopeKey,
          chapterOrdinal: scopeInfo.chapterOrdinal,
          sectionOrdinal: scopeInfo.sectionOrdinal,
          subsectionOrdinal: scopeInfo.subsectionOrdinal,
          sequenceValue,
          sourceState: sourceSnapshot.sourceState,
          sourceAuthorityReady: sourceSnapshot.sourceState !== 'UNKNOWN',
          sourceAuthorityKind: sourceSnapshot.sourceAuthorityKind,
          authoritativeRawSource: sourceSnapshot.authoritativeRawSource,
          normalizedSourceHash: sourceSnapshot.authoritativeSourceHash ?? computeNormalizedSourceHash(sourceSnapshot.authoritativeRawSource ?? ''),
          authoritativeSourceHash: sourceSnapshot.authoritativeSourceHash,
          authoritativeSourceRevision: sourceSnapshot.authoritativeSourceRevision,
          managedForNumbering,
          desiredTag,
          semanticRevision: 0,
          renderRevision: 0,
          visibleProjectionState: 'UNKNOWN',
          numberingAuthority,
        }

        slots.push(slot)
        formulaIndex++
      } catch {
        exceptionCount++
      }
    }

    emitRuntimeAudit('FORMULA-STRUCTURAL-ALIGNMENT-CLOSURE', {
      documentKey: this._documentKey,
      generation: this._documentGeneration,
      rootToken: this._editorRootToken,
      committedSlotCount: committed.length,
      hostCount: hosts.length,
      exactMatchCount: claimedByHost.size - alignedRebindCount,
      positionalRebindCount: alignedRebindCount,
      newSlotCount: slots.length - claimedByHost.size,
      exceptionCount,
      decision: exceptionCount === 0 ? 'PASS' : 'PARTIAL',
      reason: exceptionCount === 0 ? null : 'ALIGNMENT_EXCEPTION',
      runtimeMarker: R54315_RUNTIME_MARKER,
    })

    return slots
  }

  /**
   * R5.4.3.19: resolve the authoritative source snapshot for a host.
   * Priority: explicit snapshot map → carry-forward from committed state
   * (surviving host, renderer mutations preserve it) → UNKNOWN.
   * NEVER reads composite host.textContent as TeX.
   */
  private _resolveSlotSourceSnapshot(
    host: HTMLElement,
    sourceSnapshots?: Map<HTMLElement, FormulaSourceSnapshot>,
  ): FormulaSourceSnapshot {
    const explicit = sourceSnapshots?.get(host)
    if (explicit) return explicit
    // Carry-forward from the previous committed state for surviving hosts.
    if (this._committedState) {
      for (const s of this._committedState.slotsInDocumentOrder) {
        if (s.canonicalHost === host) {
          return {
            sourceState: s.sourceState,
            sourceAuthorityKind: s.sourceAuthorityKind,
            authoritativeRawSource: s.authoritativeRawSource,
            authoritativeSourceHash: s.authoritativeSourceHash,
            authoritativeSourceRevision: s.authoritativeSourceRevision,
          }
        }
      }
    }
    // UNKNOWN — never guess.
    return {
      sourceState: 'UNKNOWN',
      sourceAuthorityKind: 'NONE',
      authoritativeRawSource: null,
      authoritativeSourceHash: null,
      authoritativeSourceRevision: null,
    }
  }

  /**
   * R5.4.3.19: hydrate a slot's authoritative source from the canonical
   * authoritative-source pipeline (never from rendered DOM). Updates the
   * committed state in place at the SAME stateRevision (source refresh is not
   * a semantic operation). Emits FORMULA-AUTHORITATIVE-SOURCE-HYDRATION.
   */
  hydrateFormulaSourceAuthority(input: {
    documentKey: string
    generation: number
    editorRootToken: number
    canonicalHost: HTMLElement
    source: FormulaSourceSnapshot
  }): boolean {
    if (!this._committedState) return false
    if (input.documentKey !== this._documentKey
      || input.generation !== this._documentGeneration
      || input.editorRootToken !== this._editorRootToken) {
      emitRuntimeAudit('FORMULA-AUTHORITATIVE-SOURCE-HYDRATION', {
        documentKey: input.documentKey,
        generation: input.generation,
        editorRootToken: input.editorRootToken,
        canonicalHostToken: null,
        sourceState: input.source.sourceState,
        sourceAuthorityKind: input.source.sourceAuthorityKind,
        decision: 'FAIL',
        reason: 'CONTEXT_MISMATCH',
        runtimeMarker: R54315_RUNTIME_MARKER,
      })
      return false
    }
    const index = this._committedState.slotsInDocumentOrder.findIndex((s) => s.canonicalHost === input.canonicalHost)
    if (index < 0) {
      emitRuntimeAudit('FORMULA-AUTHORITATIVE-SOURCE-HYDRATION', {
        documentKey: input.documentKey,
        generation: input.generation,
        editorRootToken: input.editorRootToken,
        canonicalHostToken: null,
        sourceState: input.source.sourceState,
        sourceAuthorityKind: input.source.sourceAuthorityKind,
        decision: 'FAIL',
        reason: 'SLOT_NOT_FOUND_FOR_HOST',
        runtimeMarker: R54315_RUNTIME_MARKER,
      })
      return false
    }
    const before = this._committedState
    const slot = before.slotsInDocumentOrder[index]
    const updatedSlot: CanonicalFormulaSlot = {
      ...slot,
      sourceState: input.source.sourceState,
      sourceAuthorityReady: input.source.sourceState !== 'UNKNOWN',
      sourceAuthorityKind: input.source.sourceAuthorityKind,
      authoritativeRawSource: input.source.authoritativeRawSource,
      normalizedSourceHash: input.source.authoritativeSourceHash ?? computeNormalizedSourceHash(input.source.authoritativeRawSource ?? ''),
      authoritativeSourceHash: input.source.authoritativeSourceHash,
      authoritativeSourceRevision: input.source.authoritativeSourceRevision,
    }
    const slots = before.slotsInDocumentOrder.slice()
    slots[index] = updatedSlot
    this._committedState = {
      ...before,
      slotsInDocumentOrder: slots,
      slotByStableIdentity: new Map(slots.map((s) => [s.stableIdentity, s])),
      semanticSignature: computeSemanticSignature(slots),
    }
    emitRuntimeAudit('FORMULA-AUTHORITATIVE-SOURCE-HYDRATION', {
      documentKey: input.documentKey,
      generation: input.generation,
      editorRootToken: input.editorRootToken,
      canonicalHostToken: slot.canonicalHostToken,
      stableIdentity: slot.stableIdentity,
      sourceState: input.source.sourceState,
      sourceAuthorityKind: input.source.sourceAuthorityKind,
      sourceRevision: input.source.authoritativeSourceRevision,
      sourceHash: input.source.authoritativeSourceHash,
      decision: 'PASS',
      reason: null,
      runtimeMarker: R54315_RUNTIME_MARKER,
    })
    return true
  }

  // ── R5.4.3.20: Atomic PreCall Structural Adoption ────────────────────

  /**
   * R5.4.3.20: ensure a committed Store slot exists for the exact canonical
   * host BEFORE the first natural render is authorized. If missing, performs a
   * formula-only synchronous adoption (full canonical scan → INSERT_SLOT
   * commit). Later MutationObserver re-scans classify the same host as NOOP.
   */
  adoptHostIfMissing(
    editorRoot: HTMLElement,
    host: HTMLElement,
    headings: HeadingInfo[],
    context: FormulaRuntimeContext,
  ): HostAdoptionResult {
    const bound = this.bindRuntimeContext(context)
    if (!bound) return { outcome: 'CONTEXT_NOT_READY', slot: null, addedIdentityCount: 0 }
    // 1. Existing slot?
    const existing = this.lookupCommittedSlotByHost(host)
    if (existing) return { outcome: 'EXISTING_SLOT', slot: existing, addedIdentityCount: 0 }

    // 2. Full canonical scan (formula-only) to place the new host.
    const after = this.scanAfterCandidate(editorRoot, headings)
    if (!after) return { outcome: 'SCAN_FAILED', slot: null, addedIdentityCount: 0 }
    const newSlot = after.slotsInDocumentOrder.find((s) => s.canonicalHost === host) ?? null
    if (!newSlot) return { outcome: 'SCAN_FAILED', slot: null, addedIdentityCount: 0 }

    // 3. R5.4.3.20: preserve numbering/desiredTag of SURVIVING slots — the
    // fresh structural scan must never erase the already-committed numbering
    // of existing formulas (only the newly adopted host is new).
    const beforeHosts = new Map<HTMLElement, CanonicalFormulaSlot>()
    if (this._committedState) {
      for (const s of this._committedState.slotsInDocumentOrder) beforeHosts.set(s.canonicalHost, s)
    }
    const preservedAfter: CanonicalFormulaSlot[] = after.slotsInDocumentOrder.map((s) => {
      const prior = beforeHosts.get(s.canonicalHost)
      if (prior) {
        return {
          ...s,
          scopeKey: prior.scopeKey,
          chapterOrdinal: prior.chapterOrdinal,
          sectionOrdinal: prior.sectionOrdinal,
          subsectionOrdinal: prior.subsectionOrdinal,
          sequenceValue: prior.sequenceValue,
          desiredTag: prior.desiredTag,
          numberingAuthority: prior.numberingAuthority,
        }
      }
      return s
    })
    const preservedAfterState: CommittedFormulaDocumentState = {
      ...after,
      slotsInDocumentOrder: preservedAfter,
      slotByStableIdentity: new Map(preservedAfter.map((s) => [s.stableIdentity, s])),
      semanticSignature: computeSemanticSignature(preservedAfter),
      ...buildStateReadiness(preservedAfter, after.headingRevisionUsed, after.numberingPlanRevisionUsed),
    }
    const afterForAdoption = preservedAfterState

    // 4. Adopt: commit the structural delta against the current committed state.
    const before = this._committedState
    if (before) {
      const classification = this.classifyOperation(before, afterForAdoption)
      if (classification.operationKind === 'INSERT_SLOT' && classification.addedIdentities.length === 1) {
        const tx: FormulaOperationTransaction = {
          operationId: `precall-adopt-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          mutationBatchId: 'precall-structural-adoption',
          beforeStateRevision: before.stateRevision,
          beforeState: before,
          afterCandidate: afterForAdoption,
          operationKind: 'INSERT_SLOT',
          addedStableIdentities: classification.addedIdentities,
          removedStableIdentities: [],
          survivingStableIdentities: classification.survivingIdentities,
          primaryStableIdentity: classification.addedIdentities[0],
          dependencyFrontier: null,
          affectedStableIdentities: [...classification.addedIdentities, ...classification.survivingIdentities],
          targetStateRevision: before.stateRevision + 1,
          status: 'CAPTURED',
        }
        this.commitOperation(tx)
        const adopted = this.lookupCommittedSlotByHost(host)
        return { outcome: 'ADOPTED', slot: adopted, addedIdentityCount: 1 }
      }
    } else {
      // No committed state yet → the scan IS the baseline.
      this._currentRevision = afterForAdoption.stateRevision
      this._committedState = afterForAdoption
      this._documentStates.set(afterForAdoption.stateRevision, afterForAdoption)
      return { outcome: 'ADOPTED', slot: newSlot, addedIdentityCount: afterForAdoption.slotsInDocumentOrder.length }
    }
    return { outcome: 'AMBIGUOUS', slot: null, addedIdentityCount: 0 }
  }

  // ── R5.4.3.20: Transitional Current Edit Source ──────────────────────

  /**
   * Promote the ORIGINAL pre-injection tex2svg raw input as
   * TRANSITIONAL_CURRENT_EDIT_SOURCE on the exact committed slot.
   * Revision advances ONLY on a real source delta (same hash → no advance).
   * rawInput==="" → KNOWN_EMPTY (sourceAuthorityReady=true immediately).
   */
  promoteTransitionalCurrentEditSource(
    host: HTMLElement,
    rawInput: string,
    context: FormulaRuntimeContext,
  ): { ok: boolean; sourceRevisionAfter: number | null; sourceState: FormulaSourceState } {
    if (!this._committedState) return { ok: false, sourceRevisionAfter: null, sourceState: 'UNKNOWN' }
    if (context.documentKey !== this._documentKey
      || context.documentGeneration !== this._documentGeneration
      || context.editorRootToken !== this._editorRootToken) {
      emitRuntimeAudit('FORMULA-TRANSITIONAL-EDIT-SOURCE-PROMOTION', {
        documentKey: context.documentKey,
        generation: context.documentGeneration,
        editorRootToken: context.editorRootToken,
        stableIdentity: null,
        decision: 'FAIL',
        reason: 'CONTEXT_MISMATCH',
        runtimeMarker: R54315_RUNTIME_MARKER,
      })
      return { ok: false, sourceRevisionAfter: null, sourceState: 'UNKNOWN' }
    }
    const index = this._committedState.slotsInDocumentOrder.findIndex((s) => s.canonicalHost === host)
    if (index < 0) {
      emitRuntimeAudit('FORMULA-TRANSITIONAL-EDIT-SOURCE-PROMOTION', {
        documentKey: context.documentKey,
        generation: context.documentGeneration,
        editorRootToken: context.editorRootToken,
        stableIdentity: null,
        decision: 'FAIL',
        reason: 'SLOT_NOT_FOUND_FOR_HOST',
        runtimeMarker: R54315_RUNTIME_MARKER,
      })
      return { ok: false, sourceRevisionAfter: null, sourceState: 'UNKNOWN' }
    }
    const slot = this._committedState.slotsInDocumentOrder[index]
    // R5.4.3.21 P0-A: normalize the real Typora empty sentinel
    // "<Empty \space Math \space Block>" → KNOWN_EMPTY (never stored as TeX).
    const normalized = normalizeTyporaFormulaRenderInput(rawInput)
    const isKnownEmpty = normalized.normalizedSourceState === 'EMPTY'
    const baseRawSource = normalized.normalizedBaseRawSource
    const newHash = isKnownEmpty ? '' : simpleHash(normalizeTexSource(baseRawSource))
    const hashUnchanged = slot.sourceState !== 'UNKNOWN' && slot.authoritativeSourceHash === newHash
    const newRevision = (slot.authoritativeSourceRevision ?? 0) + (hashUnchanged ? 0 : 1)
    const beforeKind = slot.sourceAuthorityKind
    const beforeRevision = slot.authoritativeSourceRevision
    const updated: CanonicalFormulaSlot = {
      ...slot,
      sourceState: isKnownEmpty ? 'EMPTY' : 'NONEMPTY',
      sourceAuthorityReady: true,
      sourceAuthorityKind: isKnownEmpty ? 'KNOWN_EMPTY' : 'TRANSITIONAL_CURRENT_EDIT',
      authoritativeRawSource: isKnownEmpty ? '' : baseRawSource,
      normalizedSourceHash: newHash === '' ? computeNormalizedSourceHash('') : newHash,
      authoritativeSourceHash: newHash,
      authoritativeSourceRevision: newRevision,
    }
    const slots = this._committedState.slotsInDocumentOrder.slice()
    slots[index] = updated
    this._committedState = {
      ...this._committedState,
      slotsInDocumentOrder: slots,
      slotByStableIdentity: new Map(slots.map((s) => [s.stableIdentity, s])),
      semanticSignature: computeSemanticSignature(slots),
    }
    emitRuntimeAudit('FORMULA-TRANSITIONAL-EDIT-SOURCE-PROMOTION', {
      documentKey: context.documentKey,
      generation: context.documentGeneration,
      editorRootToken: context.editorRootToken,
      stableIdentity: slot.stableIdentity,
      formulaIndex: index,
      canonicalHostToken: slot.canonicalHostToken,
      sourceStateBefore: slot.sourceState,
      sourceAuthorityKindBefore: beforeKind,
      rawInputHash: newHash,
      rawInputLength: rawInput.length,
      sourceRevisionBefore: beforeRevision,
      sourceRevisionAfter: newRevision,
      sourceAuthorityKindAfter: isKnownEmpty ? 'KNOWN_EMPTY' : 'TRANSITIONAL_CURRENT_EDIT',
      promotionAllowed: true,
      decision: 'PASS',
      reason: hashUnchanged ? 'IDEMPOTENT_REFRESH_NO_REVISION_ADVANCE' : null,
      runtimeMarker: R54315_RUNTIME_MARKER,
    })
    return { ok: true, sourceRevisionAfter: newRevision, sourceState: isKnownEmpty ? 'EMPTY' : 'NONEMPTY' }
  }

  // ── R5.4.3.20: PendingSourceReadyProjection Registry ─────────────────

  /** Register a BLOCKED_SOURCE_NOT_READY projection for event-driven replay. */
  registerPendingSourceReadyProjection(
    tx: FormulaProjectionTransaction,
  ): PendingSourceReadyProjection {
    const pending: PendingSourceReadyProjection = {
      pendingId: `psrp-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      originProjectionTransactionId: tx.projectionTransactionId,
      operationId: tx.operationId,
      documentKey: this._documentKey,
      generation: this._documentGeneration,
      rootToken: this._editorRootToken,
      stableIdentity: tx.stableIdentity,
      formulaIndex: tx.formulaIndex,
      canonicalHostToken: tx.canonicalHostToken,
      canonicalHost: tx.canonicalHost,
      blockedStateRevision: tx.targetStateRevision,
      blockedDesiredTag: tx.desiredTag,
      reason: 'SOURCE_NOT_READY',
      status: 'PENDING',
    }
    this._pendingSourceReadyProjections.set(String(tx.stableIdentity), pending)
    return pending
  }

  getPendingSourceReadyProjectionCount(): number {
    let count = 0
    for (const p of this._pendingSourceReadyProjections.values()) {
      if (p.status === 'PENDING') count++
    }
    return count
  }

  getPendingSourceReadyProjections(): PendingSourceReadyProjection[] {
    return [...this._pendingSourceReadyProjections.values()]
  }

  markPendingSourceReadySatisfiedByNaturalRender(stableIdentity: FormulaStableIdentity): boolean {
    const pending = this._pendingSourceReadyProjections.get(String(stableIdentity))
    if (!pending || pending.status !== 'PENDING') return false
    pending.status = 'SATISFIED_BY_NATURAL_RENDER'
    this._pendingSourceReadyProjections.delete(String(stableIdentity))
    return true
  }

  retirePendingSourceReadyProjection(stableIdentity: FormulaStableIdentity): PendingSourceReadyProjection | null {
    const pending = this._pendingSourceReadyProjections.get(String(stableIdentity))
    if (!pending) return null
    pending.status = 'RETIRED'
    this._pendingSourceReadyProjections.delete(String(stableIdentity))
    return pending
  }

  /** R5.4.3.17: stable identity MUST embed the bound context; :0:0:n is a FAIL. */
  private _checkStableIdentityContextInvariant(
    identity: string,
    docKey: string,
    generation: number,
    rootToken: number,
    hostToken: number,
  ): void {
    const zeroContext = docKey === '' || generation <= 0 || rootToken <= 0
    emitRuntimeAudit('FORMULA-STABLE-IDENTITY-CONTEXT-INVARIANT', {
      stableIdentity: identity,
      documentKeyComponent: docKey,
      generationComponent: generation,
      rootComponent: rootToken,
      hostTokenComponent: hostToken,
      zeroContext,
      identitySource: 'STRUCTURAL_SLOT',
      decision: zeroContext ? 'FAIL' : 'PASS',
      reason: zeroContext ? 'ZERO_CONTEXT_STABLE_IDENTITY' : null,
      runtimeMarker: R54315_RUNTIME_MARKER,
    })
  }

  private _formatDesiredTag(
    chapterOrdinal: number | null,
    sectionOrdinal: number | null,
    subsectionOrdinal: number | null,
    sequenceValue: number,
  ): string {
    const parts: string[] = []
    if (chapterOrdinal !== null) parts.push(String(chapterOrdinal))
    if (sectionOrdinal !== null) parts.push(String(sectionOrdinal))
    if (subsectionOrdinal !== null) parts.push(String(subsectionOrdinal))
    parts.push(String(sequenceValue))
    return parts.join('.')
  }

  private _findScopeEnd(
    state: CommittedFormulaDocumentState,
    scopeKey: string | null,
    startOrder: number,
  ): number {
    if (!scopeKey) {
      // No scope — end of document
      return state.slotsInDocumentOrder.length > 0
        ? state.slotsInDocumentOrder[state.slotsInDocumentOrder.length - 1].documentOrder
        : 0
    }

    let maxOrder = startOrder
    for (const slot of state.slotsInDocumentOrder) {
      if (slot.documentOrder >= startOrder && slot.scopeKey === scopeKey) {
        maxOrder = Math.max(maxOrder, slot.documentOrder)
      } else if (slot.documentOrder > startOrder && slot.scopeKey !== scopeKey) {
        // We've moved past the scope
        break
      }
    }
    return maxOrder
  }

  private _countOrderChanges(
    before: CommittedFormulaDocumentState,
    after: CommittedFormulaDocumentState,
    survivingIdentities: Array<string | number>,
  ): number {
    let count = 0
    for (const id of survivingIdentities) {
      const beforeSlot = before.slotByStableIdentity.get(id)
      const afterSlot = after.slotByStableIdentity.get(id)
      if (beforeSlot && afterSlot && beforeSlot.documentOrder !== afterSlot.documentOrder) {
        count++
      }
    }
    return count
  }

  private _countScopeChanges(
    before: CommittedFormulaDocumentState,
    after: CommittedFormulaDocumentState,
    survivingIdentities: Array<string | number>,
  ): number {
    let count = 0
    for (const id of survivingIdentities) {
      const beforeSlot = before.slotByStableIdentity.get(id)
      const afterSlot = after.slotByStableIdentity.get(id)
      if (beforeSlot && afterSlot && beforeSlot.scopeKey !== afterSlot.scopeKey) {
        count++
      }
    }
    return count
  }

  private _countSourceChanges(
    before: CommittedFormulaDocumentState,
    after: CommittedFormulaDocumentState,
    survivingIdentities: Array<string | number>,
  ): number {
    let count = 0
    for (const id of survivingIdentities) {
      const beforeSlot = before.slotByStableIdentity.get(id)
      const afterSlot = after.slotByStableIdentity.get(id)
      if (beforeSlot && afterSlot && beforeSlot.authoritativeRawSource !== afterSlot.authoritativeRawSource) {
        // R5.4.3.19: renderer-only mutations preserve source revision/hash —
        // only a REAL source revision/hash delta counts as a source change.
        const revDelta = (afterSlot.authoritativeSourceRevision ?? 0) - (beforeSlot.authoritativeSourceRevision ?? 0)
        const hashChanged = beforeSlot.authoritativeSourceHash !== afterSlot.authoritativeSourceHash
        if (revDelta > 0 || (hashChanged && beforeSlot.authoritativeSourceHash !== null && afterSlot.authoritativeSourceHash !== null)) {
          count++
        }
      }
    }
    return count
  }

  private _countManagedChanges(
    before: CommittedFormulaDocumentState,
    after: CommittedFormulaDocumentState,
    survivingIdentities: Array<string | number>,
  ): number {
    let count = 0
    for (const id of survivingIdentities) {
      const beforeSlot = before.slotByStableIdentity.get(id)
      const afterSlot = after.slotByStableIdentity.get(id)
      if (beforeSlot && afterSlot && beforeSlot.managedForNumbering !== afterSlot.managedForNumbering) {
        count++
      }
    }
    return count
  }

  /** R5.4.3.21 P0-H: count surviving slots whose canonical host BINDING changed. */
  private _countBindingChanges(
    before: CommittedFormulaDocumentState,
    after: CommittedFormulaDocumentState,
    survivingIdentities: Array<string | number>,
  ): number {
    let count = 0
    for (const id of survivingIdentities) {
      const beforeSlot = before.slotByStableIdentity.get(id)
      const afterSlot = after.slotByStableIdentity.get(id)
      if (beforeSlot && afterSlot
        && (beforeSlot.canonicalHost !== afterSlot.canonicalHost
          || beforeSlot.canonicalHostToken !== afterSlot.canonicalHostToken)) {
        count++
      }
    }
    return count
  }
}

// ── Singleton ───────────────────────────────────────────────────────────

let _instance: FormulaStateStore | null = null

/**
 * Get the singleton FormulaStateStore instance.
 * This is the single authoritative source of truth for all formula state.
 */
export function getFormulaStateStore(): FormulaStateStore {
  if (!_instance) {
    _instance = new FormulaStateStore()
    emitRuntimeAudit('FORMULA-STATE-STORE-COMMITTED-STATE', {
      action: 'SINGLETON_INITIALIZED',
      runtimeMarker: R54315_RUNTIME_MARKER,
    })
  }
  return _instance
}

/**
 * Reset the singleton (for testing).
 */
export function resetFormulaStateStore(): void {
  _instance = null
  _operationCounter = 0
  _projectionCounter = 0
  _frontierCounter = 0
}

// ── Re-export tokenFor helper ──────────────────────────────────────────

// Minimal token helper for host elements
function tokenFor(el: HTMLElement): number {
  const key = '__inkchapter_host_token__' as unknown as number
  const existing = (el as unknown as Record<number, number>)[key]
  if (existing) return existing
  const token = Date.now() + Math.floor(Math.random() * 100000)
  Object.defineProperty(el, key, {
    value: token,
    writable: false,
    configurable: false,
  })
  return token
}